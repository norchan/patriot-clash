// Generate the Chess Puzzles bank: mate-in-1/2/3 positions found in biased
// random self-play, verified by the same narrow checks-only solver the game
// uses at runtime (lib/chess-mate.ts — keep the solver logic in sync).
// Output: config/chess-puzzles.json  [{ fen, depth, line }]
// Usage: node scripts/gen_chess_puzzles.mjs
import { Chess } from 'chess.js'
import fs from 'fs'

const QUOTA = { 1: 120, 2: 80, 3: 40 }
const TIME_BUDGET_MS = { 1: 60_000, 2: 240_000, 3: 600_000 }

// ── solver (mirror of lib/chess-mate.ts) ────────────────────────────────────
function matingMoves(fen) {
  const c = new Chess(fen); const out = []
  for (const m of c.moves()) { c.move(m); if (c.isCheckmate()) out.push(m); c.undo() }
  return out
}
function checkingMoves(fen) {
  const c = new Chess(fen); const out = []
  for (const m of c.moves()) { c.move(m); if (c.inCheck()) out.push(m); c.undo() }
  return out
}
function forcesMateIn(fen, n) {
  if (n <= 0) return false
  if (matingMoves(fen).length > 0) return true
  if (n === 1) return false
  for (const m of checkingMoves(fen)) if (moveKeepsMate(fen, m, n)) return true
  return false
}
function moveKeepsMate(fen, san, n) {
  const c = new Chess(fen)
  try { c.move(san) } catch { return false }
  if (c.isCheckmate()) return true
  if (n <= 1 || !c.inCheck()) return false
  for (const reply of c.moves()) {
    c.move(reply)
    const ok = forcesMateIn(c.fen(), n - 1)
    c.undo()
    if (!ok) return false
  }
  return true
}
function bestDefense(fen) {
  const c = new Chess(fen); const replies = c.moves()
  if (!replies.length) return null
  let best = replies[0], bestScore = Infinity
  for (const r of replies) {
    c.move(r); const f = c.fen()
    const score = matingMoves(f).length * 100 + checkingMoves(f).length
    c.undo()
    if (score < bestScore) { bestScore = score; best = r }
  }
  return best
}
// principal variation for display ("show solution")
function pv(fen, depth) {
  const line = []
  let f = fen
  for (let n = depth; n >= 1; n--) {
    const mates = matingMoves(f)
    const move = mates[0] ?? checkingMoves(f).find(m => moveKeepsMate(f, m, n))
    if (!move) return null
    const c = new Chess(f); c.move(move); line.push(move)
    if (c.isCheckmate()) return line
    const d = bestDefense(c.fen())
    if (!d) return null
    c.move(d); line.push(d)
    f = c.fen()
  }
  return null
}

// ── biased random playouts (prefer captures/checks → decisive positions) ────
function randomGamePositions() {
  const c = new Chess()
  const fens = []
  for (let ply = 0; ply < 90 && !c.isGameOver(); ply++) {
    const moves = c.moves({ verbose: true })
    const weighted = []
    for (const m of moves) {
      const w = m.captured ? 3 : (m.san.includes('+') ? 2 : 1)
      for (let i = 0; i < w; i++) weighted.push(m)
    }
    c.move(weighted[Math.floor(Math.random() * weighted.length)].san)
    if (ply >= 14) fens.push(c.fen())
  }
  return fens
}

// material signature — dedupes near-identical endings
const sig = fen => {
  const board = fen.split(' ')[0]
  return [...board].filter(ch => /[a-zA-Z]/.test(ch)).sort().join('') + '|' + fen.split(' ')[1]
}

const found = { 1: [], 2: [], 3: [] }
const seenFen = new Set()
const seenSig = { 1: new Set(), 2: new Set(), 3: new Set() }
const start = Date.now()

function tryPosition(fen) {
  if (seenFen.has(fen)) return
  seenFen.add(fen)
  const m1 = matingMoves(fen).length > 0
  if (m1) {
    if (found[1].length >= QUOTA[1] || Date.now() - start > TIME_BUDGET_MS[1]) return
    const s = sig(fen)
    if (seenSig[1].has(s)) return
    const line = pv(fen, 1)
    if (!line) return
    seenSig[1].add(s)
    found[1].push({ fen, depth: 1, line })
    return
  }
  for (const depth of [2, 3]) {
    if (found[depth].length >= QUOTA[depth]) continue
    // cheap pre-filter: need at least one checking move
    const checks = checkingMoves(fen)
    if (!checks.length) return
    if (forcesMateIn(fen, depth)) {
      // exclude "actually shorter" mates from deeper buckets
      if (depth === 3 && forcesMateIn(fen, 2)) return
      const s = sig(fen)
      if (seenSig[depth].has(s)) return
      const line = pv(fen, depth)
      if (!line || line.length < depth * 2 - 1) return
      seenSig[depth].add(s)
      found[depth].push({ fen, depth, line })
      return
    }
    return // not mate-in-2 → don't bother testing 3 (cost); next playout will bring more
  }
}

const deadline = start + Math.max(...Object.values(TIME_BUDGET_MS))
let games = 0
while (Date.now() < deadline) {
  const done = [1, 2, 3].every(d => found[d].length >= QUOTA[d])
  if (done) break
  for (const fen of randomGamePositions()) tryPosition(fen)
  games++
  if (games % 500 === 0) {
    console.log(`games=${games} m1=${found[1].length}/${QUOTA[1]} m2=${found[2].length}/${QUOTA[2]} m3=${found[3].length}/${QUOTA[3]} t=${Math.round((Date.now() - start) / 1000)}s`)
  }
}

// interleave difficulties so play order ramps naturally: 1,1,2,1,2,3,...
const order = []
const pool = { 1: [...found[1]], 2: [...found[2]], 3: [...found[3]] }
const pattern = [1, 1, 2, 1, 2, 3]
let i = 0
while (pool[1].length || pool[2].length || pool[3].length) {
  const want = pattern[i++ % pattern.length]
  const d = pool[want].length ? want : (pool[1].length ? 1 : pool[2].length ? 2 : 3)
  order.push(pool[d].shift())
}

fs.writeFileSync('config/chess-puzzles.json', JSON.stringify(order, null, 1))
console.log(`DONE games=${games} total=${order.length} (m1=${found[1].length} m2=${found[2].length} m3=${found[3].length}) → config/chess-puzzles.json`)

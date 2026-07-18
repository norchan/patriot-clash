'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'

// Landslide — an original match-3 (swap adjacent gems, match 3+, cascades).
// Match 4 forges a BLASTER gem (clears its row/column when matched);
// match 5 forges a RAINBOW BOMB (swap it with any gem to wipe that color).
// Levels have a move budget: clear the goal before it runs out or face the
// RECOUNT. Each level is a differently-shaped board. All art/code is our own.
const COLS = 8, ROWS = 8, TYPES = 6
type Special = 'H' | 'V' | 'bomb'
type Gem = { id: number; type: number; special?: Special; isNew?: boolean }
type Cell = Gem | null
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const GEMS: { main: string }[] = [
  { main: '#ff3b6b' }, { main: '#3b82f6' }, { main: '#22c55e' },
  { main: '#facc15' }, { main: '#a855f7' }, { main: '#fb923c' },
]
let ID = 1
const newGem = (isNew = false): Gem => ({ id: ID++, type: Math.floor(Math.random() * TYPES), isNew })

// ── Level board shapes (masks): true = playable cell ─────────────────────────
type Mask = boolean[][]
const C = 3.5
const gen = (f: (r: number, c: number) => boolean): Mask =>
  Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => f(r, c)))
const HEART = ['01100110', '11111111', '11111111', '11111111', '01111110', '00111100', '00011000', '00000000']
const DESIGNS: { name: string; mask: Mask }[] = [
  { name: 'Full Board', mask: gen(() => true) },
  { name: 'Diamond', mask: gen((r, c) => Math.abs(r - C) + Math.abs(c - C) <= 4.5) },
  { name: 'Circle', mask: gen((r, c) => (r - C) ** 2 + (c - C) ** 2 <= 4.3 ** 2) },
  { name: 'Cross', mask: gen((r, c) => (c >= 2 && c <= 5) || (r >= 2 && r <= 5)) },
  { name: 'Heart', mask: gen((r, c) => HEART[r][c] === '1') },
  // 3-thick ring (the old 2-thick frame starved the board of matches — the
  // top/bottom bands had no room for vertical runs and level 5 was a wall)
  { name: 'Ring', mask: gen((r, c) => r <= 2 || r >= 5 || c <= 2 || c >= 5) },
  { name: 'Pyramid', mask: gen((r, c) => Math.abs(c - C) <= r * 0.5 + 1) },
  { name: 'Hourglass', mask: gen((r, c) => Math.abs(c - C) <= Math.abs(r - C) + 1) },
]
const designFor = (lvl: number) => DESIGNS[lvl % DESIGNS.length]

function makeBoard(mask: Mask): Cell[][] {
  const b: Cell[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!mask[r][c]) continue
    let g: Gem
    do { g = newGem() } while (
      (c >= 2 && b[r][c-1]?.type === g.type && b[r][c-2]?.type === g.type) ||
      (r >= 2 && b[r-1][c]?.type === g.type && b[r-2][c]?.type === g.type)
    )
    b[r][c] = g
  }
  return b
}

// Scan for runs. 3 = clear · 4 = forge a BLASTER (H run clears its row, V run
// its column) · 5+ = forge a RAINBOW BOMB. The forge cell survives the clear —
// prefer the cell the player just swapped so specials appear under the finger.
function computeClears(b: Cell[][], pref?: { r: number; c: number }[]) {
  const cleared = new Set<string>()
  const spawns: { r: number; c: number; special: Special }[] = []
  const scan = (horizontal: boolean) => {
    const outer = horizontal ? ROWS : COLS, inner = horizontal ? COLS : ROWS
    for (let o = 0; o < outer; o++) {
      let i = 0
      while (i < inner) {
        const cell = horizontal ? b[o][i] : b[i][o]
        if (!cell) { i++; continue }
        let len = 1
        while (i + len < inner) {
          const nxt = horizontal ? b[o][i + len] : b[i + len][o]
          if (nxt && nxt.type === cell.type) len++; else break
        }
        if (len >= 3) {
          const keys: [number, number][] = []
          for (let k = 0; k < len; k++) {
            const rc: [number, number] = horizontal ? [o, i + k] : [i + k, o]
            keys.push(rc); cleared.add(`${rc[0]},${rc[1]}`)
          }
          if (len >= 4) {
            let at = keys[Math.floor(len / 2)]
            const hit = pref && keys.find(([r, c]) => pref.some(p => p.r === r && p.c === c))
            if (hit) at = hit
            if (!spawns.some(s => s.r === at[0] && s.c === at[1]))
              spawns.push({ r: at[0], c: at[1], special: len >= 5 ? 'bomb' : (horizontal ? 'H' : 'V') })
          }
        }
        i += len
      }
    }
  }
  scan(true); scan(false)
  return { cleared, spawns }
}

type Effect = { id: number; kind: 'row' | 'col' | 'flash'; idx: number }

// Any special caught in a clear detonates: blasters take their row/column,
// bombs take every gem of their color. Detonations chain into each other.
function expandSpecials(b: Cell[][], cleared: Set<string>, effects: Omit<Effect, 'id'>[]) {
  const done = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const key of [...cleared]) {
      if (done.has(key)) continue
      done.add(key)
      const [r, c] = key.split(',').map(Number)
      const g = b[r][c]
      if (!g?.special) continue
      const add = (rr: number, cc: number) => {
        const k = `${rr},${cc}`
        if (b[rr][cc] && !cleared.has(k)) { cleared.add(k); changed = true }
      }
      if (g.special === 'H') { effects.push({ kind: 'row', idx: r }); for (let i = 0; i < COLS; i++) add(r, i) }
      else if (g.special === 'V') { effects.push({ kind: 'col', idx: c }); for (let i = 0; i < ROWS; i++) add(i, c) }
      else { effects.push({ kind: 'flash', idx: 0 }); for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) if (b[rr][cc]?.type === g.type) add(rr, cc) }
    }
  }
}

// Gravity within each contiguous open segment of a column (so walls hold gems).
function applyGravity(b: Cell[][], mask: Mask) {
  for (let c = 0; c < COLS; c++) {
    let r = 0
    while (r < ROWS) {
      if (!mask[r][c]) { r++; continue }
      const seg: number[] = []
      while (r < ROWS && mask[r][c]) { seg.push(r); r++ }
      const survivors = seg.filter(rr => b[rr][c]).map(rr => b[rr][c]!)
      const need = seg.length - survivors.length
      seg.forEach((rr, idx) => { b[rr][c] = idx < need ? newGem(true) : survivors[idx - need] })
    }
  }
}

function hasMoves(b: Cell[][], mask: Mask): boolean {
  // a rainbow bomb can always be swapped into any neighbor
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (b[r][c]?.special === 'bomb') return true
  const test = (r1: number, c1: number, r2: number, c2: number) => {
    if (!b[r1][c1] || !b[r2][c2]) return false
    ;[b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]]
    const ok = computeClears(b).cleared.size > 0
    ;[b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]]
    return ok
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!mask[r][c]) continue
    if (c + 1 < COLS && mask[r][c+1] && test(r, c, r, c+1)) return true
    if (r + 1 < ROWS && mask[r+1][c] && test(r, c, r+1, c)) return true
  }
  return false
}

const goalFor = (lvl: number) => 40 + lvl * 20  // gems to clear to finish a puzzle
const movesFor = (lvl: number) => 24 + lvl * 3  // move budget — run out = RECOUNT
const timeFor = (lvl: number) => Math.min(240, 120 + lvl * 10)  // seconds — moves OR clock, whichever runs out first

export default function LandslidePage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [cell, setCell] = useState(44)
  const [, force] = useState(0)
  const rerender = () => force(v => v + 1)
  const maskRef = useRef<Mask>(designFor(0).mask)
  const boardRef = useRef<Cell[][]>(makeBoard(maskRef.current))
  const [removing, setRemoving] = useState<{ id: number; type: number; special?: Special; r: number; c: number }[]>([])
  const resolving = useRef(false)
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)

  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(0)
  const [designName, setDesignName] = useState(designFor(0).name)
  const [cleared, setCleared] = useState(0)
  const [goal, setGoal] = useState(goalFor(0))
  const [moves, setMoves] = useState(movesFor(0))
  const [phase, setPhase] = useState<'start' | 'playing' | 'won' | 'lost'>('start')
  const [timeLeft, setTimeLeft] = useState(timeFor(0))
  const [loseReason, setLoseReason] = useState<'moves' | 'time'>('moves')
  const timeUpRef = useRef(false)
  const [savedLevel, setSavedLevel] = useState(0)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpGame, setFpGame] = useState(0)
  const [fpToast, setFpToast] = useState('')
  const [effects, setEffects] = useState<Effect[]>([])
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number; color: string; dx: number; dy: number }[]>([])
  const [popup, setPopup] = useState<{ text: string; key: number; big: boolean } | null>(null)

  const scoreRef = useRef(0), clearedRef = useRef(0), fpGameRef = useRef(0), movesRef = useRef(movesFor(0))
  const fxId = useRef(1)
  const popupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    for (let i = 0; i < TYPES; i++) { const im = new Image(); im.src = `/gems/gem${i}.png` }
  }, [])
  useEffect(() => { if (profile && balance === null) setBalance(profile.fp_balance) }, [profile, balance])
  useEffect(() => {
    const s = parseInt(localStorage.getItem('landslide_level') || '0', 10)
    if (!isNaN(s)) setSavedLevel(Math.max(0, Math.min(999, s)))
  }, [])
  useEffect(() => {
    const fit = () => {
      const w = Math.min(window.innerWidth, 448) - 20
      const h = window.innerHeight - 230
      setCell(Math.max(30, Math.floor(Math.min(w / COLS, h / ROWS))))
    }
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // Server-owned play session (anti-farm): rewards must reference it
  const sessionRef = useRef<string | null>(null)
  const cappedRef = useRef(false)
  useEffect(() => {
    fetch('/api/arcade/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'landslide' }),
    }).then(r => r.json()).then(d => { sessionRef.current = d.session_id ?? null }).catch(() => {})
  }, [])

  async function reward(event: 'clear' | 'level', extra: { count?: number; level: number }) {
    try {
      const res = await fetch('/api/arcade/landslide/reward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...extra, session_id: sessionRef.current }),
      })
      const d = await res.json()
      if (res.ok && d.awarded > 0) {
        fpGameRef.current += d.awarded; setFpGame(fpGameRef.current)
        setBalance(d.balance); sfx.coin()
        setFpToast(`+${d.awarded} FP`); setTimeout(() => setFpToast(''), 1100)
      } else if (res.ok && d.capped && !cappedRef.current) {
        cappedRef.current = true
        setFpToast('🏁 Daily arcade FP cap reached — playing for glory!')
        setTimeout(() => setFpToast(''), 2600)
      }
    } catch {}
  }
  // Re-render in place. We MUST NOT replace boardRef.current here: the cascade
  // captures `b = boardRef.current` and mutates it across await points, so
  // swapping the reference would strand the gravity step on a stale array and
  // the gems would never visibly fall.
  const commit = () => rerender()

  function showPopup(text: string, big = false) {
    if (popupTimer.current) clearTimeout(popupTimer.current)
    setPopup({ text, big, key: fxId.current++ })
    popupTimer.current = setTimeout(() => setPopup(null), big ? 1100 : 800)
  }

  function burstSparks(cells: { r: number; c: number; type: number }[]) {
    const out: typeof sparks = []
    for (const { r, c, type } of cells.slice(0, 18)) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, d = 18 + Math.random() * 30
        out.push({ id: fxId.current++, x: c * cell + cell / 2, y: r * cell + cell / 2,
          color: GEMS[type].main, dx: Math.cos(a) * d, dy: Math.sin(a) * d - 12 })
      }
    }
    setSparks(s => [...s, ...out])
    setTimeout(() => setSparks(s => s.filter(x => !out.some(o => o.id === x.id))), 600)
  }

  function playEffects(fx: Omit<Effect, 'id'>[]) {
    if (!fx.length) return
    const withIds = fx.slice(0, 6).map(f => ({ ...f, id: fxId.current++ }))
    setEffects(e => [...e, ...withIds])
    setTimeout(() => setEffects(e => e.filter(x => !withIds.some(w => w.id === x.id))), 450)
  }

  const resolveCascades = useCallback(async (lvl: number, pref?: { r: number; c: number }[]) => {
    let combo = 1, gain = 0, total = 0
    while (true) {
      const b = boardRef.current
      const { cleared: clr, spawns } = computeClears(b, combo === 1 ? pref : undefined)
      if (clr.size === 0) break
      const fx: Omit<Effect, 'id'>[] = []
      expandSpecials(b, clr, fx)
      // forge cells transform instead of clearing — the special survives the wave
      for (const sp of spawns) {
        clr.delete(`${sp.r},${sp.c}`)
        const g = b[sp.r][sp.c]
        if (g) g.special = sp.special
      }
      const rem = [...clr].map(k => { const [r, c] = k.split(',').map(Number); const g = b[r][c]!; return { id: g.id, type: g.type, special: g.special, r, c } })
      setRemoving(rem)
      for (const k of clr) { const [r, c] = k.split(',').map(Number); b[r][c] = null }
      playEffects(fx)
      burstSparks(rem)
      fx.length || combo >= 3 ? sfx.blast() : sfx.match(combo)
      if (spawns.some(s => s.special === 'bomb')) showPopup('🌈 RAINBOW BOMB!', true)
      else if (spawns.length) showPopup('⚡ BLASTER FORGED!')
      else if (clr.size >= 14) showPopup('SUPERMAJORITY!', true)
      else if (combo >= 4) showPopup('LANDSLIDE!', true)
      else if (combo >= 2) showPopup(`COMBO ×${combo}`)
      commit(); await sleep(200)
      setRemoving([])
      gain += clr.size * 30 * combo; total += clr.size
      applyGravity(b, maskRef.current); commit(); await sleep(260)
      combo++
    }
    if (gain > 0) {
      scoreRef.current += gain; setScore(scoreRef.current)
      clearedRef.current += total; setCleared(clearedRef.current)
      reward('clear', { count: total, level: lvl })
    }
  }, [cell]) // eslint-disable-line react-hooks/exhaustive-deps

  function spendMove() { movesRef.current -= 1; setMoves(movesRef.current) }

  async function endOfMove() {
    if (!hasMoves(boardRef.current, maskRef.current)) {
      boardRef.current = makeBoard(maskRef.current); commit(); await sleep(120)
    }
    resolving.current = false
    if (clearedRef.current >= goal) winLevel()
    else if (timeUpRef.current) loseLevel('time')
    else if (movesRef.current <= 0) loseLevel('moves')
  }

  const adj = (a: { r: number; c: number }, b: { r: number; c: number }) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1

  const trySwap = useCallback(async (a: { r: number; c: number }, b: { r: number; c: number }) => {
    if (resolving.current || phase !== 'playing') return
    const bd = boardRef.current
    const ga = bd[a.r][a.c], gb = bd[b.r][b.c]
    if (!ga || !gb) return
    resolving.current = true

    // RAINBOW BOMB swap: wipe every gem of the partner's color right now
    if (ga.special === 'bomb' || gb.special === 'bomb') {
      ;[bd[a.r][a.c], bd[b.r][b.c]] = [bd[b.r][b.c], bd[a.r][a.c]]
      sfx.swap(); commit(); await sleep(160)
      const bomb = ga.special === 'bomb' ? ga : gb
      const other = bomb === ga ? gb : ga
      const both = other.special === 'bomb'
      const clr = new Set<string>()
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const g = bd[r][c]
        if (g && (g.id === bomb.id || g.id === other.id || both || g.type === other.type)) clr.add(`${r},${c}`)
      }
      const fx: Omit<Effect, 'id'>[] = [{ kind: 'flash', idx: 0 }]
      expandSpecials(bd, clr, fx)
      const rem = [...clr].map(k => { const [r, c] = k.split(',').map(Number); const g = bd[r][c]!; return { id: g.id, type: g.type, special: g.special, r, c } })
      setRemoving(rem)
      for (const k of clr) { const [r, c] = k.split(',').map(Number); bd[r][c] = null }
      playEffects(fx); burstSparks(rem); sfx.blast()
      showPopup(both ? '💥 TOTAL LANDSLIDE!' : '🌈 COLOR WIPE!', true)
      commit(); await sleep(220)
      setRemoving([])
      const gained = clr.size * 40
      scoreRef.current += gained; setScore(scoreRef.current)
      clearedRef.current += clr.size; setCleared(clearedRef.current)
      reward('clear', { count: clr.size, level })
      applyGravity(bd, maskRef.current); commit(); await sleep(260)
      spendMove()
      await resolveCascades(level)
      await endOfMove()
      return
    }

    ;[bd[a.r][a.c], bd[b.r][b.c]] = [bd[b.r][b.c], bd[a.r][a.c]]
    sfx.swap(); commit(); await sleep(160)
    if (computeClears(bd).cleared.size === 0) {
      ;[bd[a.r][a.c], bd[b.r][b.c]] = [bd[b.r][b.c], bd[a.r][a.c]]
      sfx.invalid(); commit(); await sleep(160)
      resolving.current = false; return
    }
    spendMove()
    await resolveCascades(level, [a, b])
    await endOfMove()
  }, [phase, level, goal, resolveCascades]) // eslint-disable-line react-hooks/exhaustive-deps

  function winLevel() {
    setPhase('won'); sfx.levelUp()
    reward('level', { level })
    const nl = level + 1
    if (nl > (parseInt(localStorage.getItem('landslide_level') || '0', 10) || 0)) {
      localStorage.setItem('landslide_level', String(nl)); setSavedLevel(nl)
    }
    refetch()
  }

  function loseLevel(reason: 'moves' | 'time' = 'moves') { setLoseReason(reason); setPhase('lost'); sfx.gameOver() }

  // Level clock — moves OR time, whichever runs out first. If time expires
  // mid-cascade, the cascade finishes (endOfMove sees timeUpRef) so a win at
  // the buzzer still counts.
  useEffect(() => {
    if (phase !== 'playing') return
    const t = setInterval(() => {
      setTimeLeft(v => {
        if (v <= 1) {
          clearInterval(t)
          timeUpRef.current = true
          if (!resolving.current) loseLevel('time')
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  function startLevel(lvl: number) {
    const d = designFor(lvl)
    maskRef.current = d.mask
    boardRef.current = makeBoard(d.mask)
    // guarantee an opening move
    let guard = 0
    while (!hasMoves(boardRef.current, d.mask) && guard++ < 30) boardRef.current = makeBoard(d.mask)
    setSel(null); setRemoving([]); setEffects([]); setSparks([]); setPopup(null); resolving.current = false
    scoreRef.current = 0; clearedRef.current = 0; fpGameRef.current = 0; movesRef.current = movesFor(lvl)
    timeUpRef.current = false; setTimeLeft(timeFor(lvl)); setLoseReason('moves')
    setScore(0); setCleared(0); setFpGame(0); setMoves(movesFor(lvl))
    setLevel(lvl); setDesignName(d.name); setGoal(goalFor(lvl))
    commit(); setPhase('playing')
  }
  const nextLevel = () => startLevel(level + 1)
  const resetToZero = () => { localStorage.setItem('landslide_level', '0'); setSavedLevel(0); startLevel(0) }

  function tapCell(r: number, c: number) {
    if (resolving.current || phase !== 'playing' || !boardRef.current[r][c]) return
    if (!sel) { setSel({ r, c }); return }
    if (sel.r === r && sel.c === c) { setSel(null); return }
    if (adj(sel, { r, c })) { const a = sel; setSel(null); trySwap(a, { r, c }) }
    else setSel({ r, c })
  }
  const dragRef = useRef<{ r: number; c: number; x: number; y: number; moved: boolean } | null>(null)
  const onGemDown = (r: number, c: number, e: React.PointerEvent) => {
    if (resolving.current || phase !== 'playing') return
    dragRef.current = { r, c, x: e.clientX, y: e.clientY, moved: false }; setSel({ r, c })
  }
  const onBoardMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.moved) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.hypot(dx, dy) < cell * 0.4) return
    d.moved = true
    let tr = d.r, tc = d.c
    if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1; else tr += dy > 0 ? 1 : -1
    dragRef.current = null; setSel(null)
    if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS && maskRef.current[tr][tc]) trySwap({ r: d.r, c: d.c }, { r: tr, c: tc })
  }
  const onBoardUp = () => { const d = dragRef.current; if (d && !d.moved) tapCell(d.r, d.c); dragRef.current = null }

  const boardPx = COLS * cell
  const pct = Math.min(100, (cleared / goal) * 100)
  const movesTotal = movesFor(level)
  const stars = phase === 'won' ? (moves / movesTotal >= 0.35 ? 3 : moves / movesTotal >= 0.12 ? 2 : 1) : 0

  return (
    <div className="min-h-screen text-white relative select-none overflow-hidden"
      style={{
        // painted key-art backdrop (gem landslide valley) with a dark overlay
        // so the board and HUD stay readable on top of it
        backgroundImage: 'linear-gradient(180deg, rgba(24,10,44,0.50), rgba(18,8,36,0.66) 45%, rgba(14,6,30,0.78)), url(/arcade/landslide-bg.jpg)',
        backgroundSize: 'cover', backgroundPosition: 'center top',
        backgroundColor: '#2a1650',
        fontFamily: 'ui-monospace, monospace',
      }}>
      <div className="px-4 pt-4 pb-1 flex items-center gap-3 relative z-20">
        <button onClick={() => router.push('/arcade')} className="text-white/80 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.12em] text-xl" style={{ color: '#fff', textShadow: '0 0 12px #f0abfc, 0 2px 0 #000' }}>LANDSLIDE</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()}</span>
      </div>

      <div className="px-3 grid grid-cols-5 gap-1.5 max-w-md mx-auto mt-1">
        <Meter label="SCORE" value={score.toLocaleString()} color="#67e8f9" />
        <Meter label="MOVES" value={String(moves)} color={moves <= 5 ? '#f87171' : '#fbbf24'} pulse={phase === 'playing' && moves <= 5} />
        <Meter label="TIME" value={`${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`}
          color={timeLeft <= 20 ? '#f87171' : '#67e8f9'} pulse={phase === 'playing' && timeLeft <= 20} />
        <Meter label={`LEVEL ${level}`} value={designName} color="#f0abfc" small />
        <Meter label="CLEARED" value={`${Math.min(cleared, goal)}/${goal}`} color="#4ade80" />
      </div>

      <div className="max-w-md mx-auto px-4 mt-2">
        <div className="h-2.5 rounded-full bg-black/40 overflow-hidden border border-white/20">
          <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#facc15,#f472b6,#22d3ee)' }} />
        </div>
      </div>

      <div className="flex justify-center mt-3 px-2">
        <div className="relative rounded-2xl p-1.5" style={{ width: boardPx + 12, height: boardPx + 12, background: 'rgba(0,0,0,0.28)', boxShadow: '0 10px 40px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.12)' }}>
          <div className="relative overflow-hidden rounded-lg" style={{ width: boardPx, height: boardPx, touchAction: 'none' }}
            onPointerMove={onBoardMove} onPointerUp={onBoardUp} onPointerLeave={onBoardUp}>
            {/* board-shape tiles */}
            {maskRef.current.map((row, r) => row.map((open, c) => open && (
              <div key={`t${r}-${c}`} className="absolute" style={{ left: c * cell, top: r * cell, width: cell, height: cell }}>
                <div className="absolute inset-[3px] rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' }} />
              </div>
            )))}
            {/* gems */}
            {boardRef.current.map((row, r) => row.map((g, c) => g && (
              <GemView key={g.id} g={g} r={r} c={c} cell={cell}
                selected={!!sel && sel.r === r && sel.c === c} onDown={e => onGemDown(r, c, e)} />
            )))}
            {removing.map(x => (
              <GemView key={`x${x.id}`} g={{ id: x.id, type: x.type, special: x.special }} r={x.r} c={x.c} cell={cell} removing onDown={() => {}} />
            ))}
            {/* blaster beams + bomb flash */}
            {effects.map(f => f.kind === 'flash' ? (
              <div key={f.id} className="absolute inset-0 pointer-events-none z-30" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.75), rgba(250,204,21,0.25) 60%, transparent)', animation: 'fxFade 0.45s ease-out forwards' }} />
            ) : (
              <div key={f.id} className="absolute pointer-events-none z-30" style={{
                left: f.kind === 'col' ? f.idx * cell : 0, top: f.kind === 'row' ? f.idx * cell : 0,
                width: f.kind === 'col' ? cell : boardPx, height: f.kind === 'row' ? cell : boardPx,
                background: f.kind === 'row'
                  ? 'linear-gradient(180deg, transparent, rgba(255,255,255,0.9), transparent)'
                  : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)',
                animation: 'fxFade 0.45s ease-out forwards',
              }} />
            ))}
            {/* clear-burst sparks */}
            {sparks.map(s => (
              <div key={s.id} className="absolute rounded-full pointer-events-none z-30" style={{
                left: s.x - 3, top: s.y - 3, width: 6, height: 6, background: s.color,
                boxShadow: `0 0 6px ${s.color}`,
                ['--dx' as string]: `${s.dx}px`, ['--dy' as string]: `${s.dy}px`,
                animation: 'sparkFly 0.55s ease-out forwards',
              }} />
            ))}
          </div>
          {fpToast && (
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-green-300 font-black text-lg pointer-events-none z-30 whitespace-nowrap" style={{ textShadow: '0 0 8px #22c55e' }}>{fpToast}</div>
          )}
          {popup && (
            <div key={popup.key} className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
              <div className={`font-black ${popup.big ? 'text-4xl' : 'text-2xl'}`} style={{
                color: '#fff', textShadow: '0 0 18px #f0abfc, 0 0 6px #fff, 0 3px 0 #000',
                animation: 'popIn 0.7s cubic-bezier(.2,1.6,.4,1) forwards',
              }}>{popup.text}</div>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-white/50 text-[11px] mt-3">Match 3 to clear · 4 forges a ⚡ BLASTER · 5 forges a 🌈 RAINBOW BOMB</p>

      {phase !== 'playing' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6 max-w-md mx-auto">
          {phase === 'won' && <Confetti />}
          <div className="text-center w-full relative">
            {phase === 'start' && <>
              <h2 className="text-4xl font-black" style={{ color: '#fff', textShadow: '0 0 16px #f0abfc' }}>LANDSLIDE</h2>
              <p className="text-white/70 text-sm mt-2">Hit the clear goal before your moves — or the clock — run out.</p>
              <p className="text-white/60 text-xs mt-1.5">Match 4 → ⚡ blaster clears a full line · Match 5 → 🌈 bomb wipes a color</p>
              <p className="text-pink-200 text-xs mt-3">Saved level: <b className="text-white">{savedLevel}</b> · {designFor(savedLevel).name}</p>
              <button onClick={() => startLevel(savedLevel)} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg" style={{ background: 'radial-gradient(circle at 50% 30%,#f472b6,#be185d)' }}>
                {savedLevel > 0 ? `▶ CONTINUE — LEVEL ${savedLevel}` : '▶ START'}
              </button>
              {savedLevel > 0 && <button onClick={resetToZero} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Reset to Level 0</button>}
            </>}
            {phase === 'won' && <>
              <div className="text-3xl tracking-[0.4em] mb-1">
                {[1, 2, 3].map(i => <span key={i} style={{ opacity: i <= stars ? 1 : 0.22, textShadow: i <= stars ? '0 0 12px #facc15' : 'none' }}>⭐</span>)}
              </div>
              <h2 className="text-3xl font-black text-green-300" style={{ textShadow: '0 0 14px #22c55e' }}>LANDSLIDE VICTORY!</h2>
              <p className="text-white/60 text-xs mt-1">Level {level} · {designName} · {moves} moves to spare</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Meter label="SCORE" value={score.toLocaleString()} color="#67e8f9" />
                <Meter label="FP EARNED" value={`+${fpGame.toLocaleString()}`} color="#4ade80" />
              </div>
              <p className="text-pink-200 text-xs mt-3">Next: <b className="text-white">{designFor(level + 1).name}</b> · goal {goalFor(level + 1)} · {movesFor(level + 1)} moves</p>
              <button onClick={nextLevel} className="w-full mt-4 py-3.5 rounded-xl font-black text-lg" style={{ background: 'radial-gradient(circle at 50% 30%,#f472b6,#be185d)' }}>▶ NEXT PUZZLE</button>
            </>}
            {phase === 'lost' && <>
              <h2 className="text-3xl font-black text-red-400" style={{ textShadow: '0 0 14px #ef4444' }}>RECOUNT!</h2>
              <p className="text-white/70 text-sm mt-2">{loseReason === 'time' ? "Time's up" : 'Out of moves'} — {Math.min(cleared, goal)}/{goal} cleared.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Meter label="SCORE" value={score.toLocaleString()} color="#67e8f9" />
                <Meter label="FP EARNED" value={`+${fpGame.toLocaleString()}`} color="#4ade80" />
              </div>
              <button onClick={() => startLevel(level)} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg" style={{ background: 'radial-gradient(circle at 50% 30%,#f87171,#b91c1c)' }}>↻ DEMAND A RECOUNT</button>
              <button onClick={() => router.push('/arcade')} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Back to Arcade</button>
            </>}
          </div>
        </div>
      )}

      <style>{`
        @keyframes landBg { 0%,100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }
        @keyframes gemDrop { from { transform: translateY(-560%) } to { transform: translateY(0) } }
        @keyframes fxFade { from { opacity: 1 } to { opacity: 0 } }
        @keyframes sparkFly { from { transform: translate(0,0); opacity: 1 } to { transform: translate(var(--dx), var(--dy)); opacity: 0 } }
        @keyframes popIn { 0% { transform: scale(0.3); opacity: 0 } 25% { transform: scale(1.15); opacity: 1 } 75% { transform: scale(1); opacity: 1 } 100% { transform: scale(1); opacity: 0 } }
        @keyframes specialPulse { 0%,100% { opacity: 0.75 } 50% { opacity: 1 } }
        @keyframes bombSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes meterPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.08) } }
        @keyframes confFall { from { transform: translateY(-8vh) rotate(0deg); opacity: 1 } to { transform: translateY(105vh) rotate(720deg); opacity: 0.6 } }
      `}</style>
    </div>
  )
}

function GemView({ g, r, c, cell, selected, removing, onDown }:
  { g: Gem; r: number; c: number; cell: number; selected?: boolean; removing?: boolean; onDown: (e: React.PointerEvent) => void }) {
  const gem = GEMS[g.type]
  return (
    <button onPointerDown={onDown} className="absolute"
      style={{
        left: c * cell, top: r * cell, width: cell, height: cell,
        transition: removing ? 'transform 0.2s ease, opacity 0.2s ease' : 'top 0.26s cubic-bezier(.34,1.1,.5,1), left 0.15s ease, transform 0.12s ease',
        transform: removing ? 'scale(0.1) rotate(20deg)' : selected ? 'scale(1.16)' : 'scale(1)',
        opacity: removing ? 0 : 1, zIndex: selected ? 20 : 10,
      }}>
      <img src={`/gems/gem${g.type}.png`} alt="" draggable={false}
        style={{
          width: '100%', height: '100%', objectFit: 'contain',
          filter: selected ? `drop-shadow(0 0 12px ${gem.main}) drop-shadow(0 0 4px #fff)`
            : g.special ? `drop-shadow(0 0 8px ${g.special === 'bomb' ? '#fff' : gem.main}) drop-shadow(0 3px 4px rgba(0,0,0,0.55))`
            : 'drop-shadow(0 3px 4px rgba(0,0,0,0.55))',
          animation: g.isNew ? 'gemDrop 0.34s ease-in' : undefined,
        }} />
      {/* special markers: blaster stripe / rainbow bomb ring */}
      {g.special === 'H' && (
        <div className="absolute pointer-events-none" style={{ left: '10%', right: '10%', top: '42%', height: '16%', borderRadius: 4,
          background: 'linear-gradient(90deg, transparent, #fff, transparent)', animation: 'specialPulse 0.9s ease-in-out infinite' }} />
      )}
      {g.special === 'V' && (
        <div className="absolute pointer-events-none" style={{ top: '10%', bottom: '10%', left: '42%', width: '16%', borderRadius: 4,
          background: 'linear-gradient(180deg, transparent, #fff, transparent)', animation: 'specialPulse 0.9s ease-in-out infinite' }} />
      )}
      {g.special === 'bomb' && (
        <div className="absolute pointer-events-none" style={{ inset: '6%', borderRadius: '50%',
          border: '3px solid transparent',
          background: 'conic-gradient(#ff3b6b,#facc15,#22c55e,#3b82f6,#a855f7,#ff3b6b) border-box',
          WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor', maskComposite: 'exclude',
          animation: 'bombSpin 1.6s linear infinite' }} />
      )}
    </button>
  )
}

function Confetti() {
  const [pieces] = useState(() => Array.from({ length: 26 }, (_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 0.9,
    color: GEMS[i % GEMS.length].main, size: 6 + Math.random() * 7, dur: 1.4 + Math.random() * 1.2,
  })))
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map(p => (
        <div key={p.id} className="absolute" style={{
          left: `${p.left}%`, top: 0, width: p.size, height: p.size * 0.55, background: p.color,
          animation: `confFall ${p.dur}s ease-in ${p.delay}s forwards`, borderRadius: 2,
        }} />
      ))}
    </div>
  )
}

function Meter({ label, value, color, small, pulse }: { label: string; value: string; color: string; small?: boolean; pulse?: boolean }) {
  return (
    <div className="rounded-lg py-1.5 border text-center" style={{ background: 'rgba(0,0,0,0.32)', borderColor: 'rgba(255,255,255,0.14)',
      animation: pulse ? 'meterPulse 0.9s ease-in-out infinite' : undefined }}>
      <div className="text-[8px] tracking-widest text-white/50">{label}</div>
      <div className={`font-black tabular-nums ${small ? 'text-xs' : 'text-base'}`} style={{ color }}>{value}</div>
    </div>
  )
}

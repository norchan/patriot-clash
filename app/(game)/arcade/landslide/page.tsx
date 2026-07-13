'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'

// Landslide — an original match-3 (swap adjacent gems, match 3+, cascades).
// Each level is a differently-shaped board. All art/code here is our own.
const COLS = 8, ROWS = 8, TYPES = 6
type Gem = { id: number; type: number; isNew?: boolean }
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
  { name: 'Ring', mask: gen((r, c) => r <= 1 || r >= 6 || c <= 1 || c >= 6) },
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

function computeClears(b: Cell[][]): Set<string> {
  const cleared = new Set<string>()
  const blastRC: [number, number][] = []
  const blastType = new Set<number>()
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
          for (let k = 0; k < len; k++) cleared.add(horizontal ? `${o},${i+k}` : `${i+k},${o}`)
          const midK = i + Math.floor(len / 2)
          if (len >= 4) blastRC.push(horizontal ? [o, midK] : [midK, o])
          if (len >= 5) blastType.add(cell.type)
        }
        i += len
      }
    }
  }
  scan(true); scan(false)
  for (const [r, c] of blastRC) {
    for (let i = 0; i < COLS; i++) if (b[r][i]) cleared.add(`${r},${i}`)
    for (let i = 0; i < ROWS; i++) if (b[i][c]) cleared.add(`${i},${c}`)
  }
  if (blastType.size) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
    if (b[r][c] && blastType.has(b[r][c]!.type)) cleared.add(`${r},${c}`)
  return cleared
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
  const test = (r1: number, c1: number, r2: number, c2: number) => {
    if (!b[r1][c1] || !b[r2][c2]) return false
    ;[b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]]
    const ok = computeClears(b).size > 0
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

const goalFor = (lvl: number) => 40 + lvl * 20 // gems to clear to finish a puzzle

export default function LandslidePage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [cell, setCell] = useState(44)
  const [, force] = useState(0)
  const rerender = () => force(v => v + 1)
  const maskRef = useRef<Mask>(designFor(0).mask)
  const boardRef = useRef<Cell[][]>(makeBoard(maskRef.current))
  const [removing, setRemoving] = useState<{ id: number; type: number; r: number; c: number }[]>([])
  const resolving = useRef(false)
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)

  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(0)
  const [designName, setDesignName] = useState(designFor(0).name)
  const [cleared, setCleared] = useState(0)
  const [goal, setGoal] = useState(goalFor(0))
  const [phase, setPhase] = useState<'start' | 'playing' | 'won'>('start')
  const [savedLevel, setSavedLevel] = useState(0)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpGame, setFpGame] = useState(0)
  const [fpToast, setFpToast] = useState('')

  const scoreRef = useRef(0), clearedRef = useRef(0), fpGameRef = useRef(0)

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

  async function reward(event: 'clear' | 'level', extra: { count?: number; level: number }) {
    try {
      const res = await fetch('/api/arcade/landslide/reward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...extra }),
      })
      const d = await res.json()
      if (res.ok && d.awarded > 0) {
        fpGameRef.current += d.awarded; setFpGame(fpGameRef.current)
        setBalance(d.balance); sfx.coin()
        setFpToast(`+${d.awarded} FP`); setTimeout(() => setFpToast(''), 1100)
      }
    } catch {}
  }
  // Re-render in place. We MUST NOT replace boardRef.current here: the cascade
  // captures `b = boardRef.current` and mutates it across await points, so
  // swapping the reference would strand the gravity step on a stale array and
  // the gems would never visibly fall.
  const commit = () => rerender()

  const resolveCascades = useCallback(async (lvl: number) => {
    let combo = 1, gain = 0, total = 0
    while (true) {
      const b = boardRef.current
      const clr = computeClears(b)
      if (clr.size === 0) break
      const rem = [...clr].map(k => { const [r, c] = k.split(',').map(Number); const g = b[r][c]!; return { id: g.id, type: g.type, r, c } })
      setRemoving(rem)
      for (const k of clr) { const [r, c] = k.split(',').map(Number); b[r][c] = null }
      combo >= 3 ? sfx.blast() : sfx.match(combo)
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
  }, [])

  const adj = (a: { r: number; c: number }, b: { r: number; c: number }) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1

  const trySwap = useCallback(async (a: { r: number; c: number }, b: { r: number; c: number }) => {
    if (resolving.current || phase !== 'playing') return
    const bd = boardRef.current
    if (!bd[a.r][a.c] || !bd[b.r][b.c]) return
    resolving.current = true
    ;[bd[a.r][a.c], bd[b.r][b.c]] = [bd[b.r][b.c], bd[a.r][a.c]]
    sfx.swap(); commit(); await sleep(160)
    if (computeClears(bd).size === 0) {
      ;[bd[a.r][a.c], bd[b.r][b.c]] = [bd[b.r][b.c], bd[a.r][a.c]]
      sfx.invalid(); commit(); await sleep(160)
      resolving.current = false; return
    }
    await resolveCascades(level)
    // reshuffle if no moves remain
    if (!hasMoves(boardRef.current, maskRef.current)) {
      boardRef.current = makeBoard(maskRef.current); commit(); await sleep(120)
    }
    resolving.current = false
    if (clearedRef.current >= goal) winLevel()
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

  function startLevel(lvl: number) {
    const d = designFor(lvl)
    maskRef.current = d.mask
    boardRef.current = makeBoard(d.mask)
    // guarantee an opening move
    let guard = 0
    while (!hasMoves(boardRef.current, d.mask) && guard++ < 30) boardRef.current = makeBoard(d.mask)
    setSel(null); setRemoving([]); resolving.current = false
    scoreRef.current = 0; clearedRef.current = 0; fpGameRef.current = 0
    setScore(0); setCleared(0); setFpGame(0)
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

  return (
    <div className="min-h-screen text-white relative select-none overflow-hidden"
      style={{ background: 'linear-gradient(135deg,#4c1d95,#831843,#1e3a8a,#312e81)', backgroundSize: '400% 400%', animation: 'landBg 18s ease infinite', fontFamily: 'ui-monospace, monospace' }}>
      <div className="px-4 pt-4 pb-1 flex items-center gap-3 relative z-20">
        <button onClick={() => router.push('/arcade')} className="text-white/80 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.12em] text-xl" style={{ color: '#fff', textShadow: '0 0 12px #f0abfc, 0 2px 0 #000' }}>LANDSLIDE</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()}</span>
      </div>

      <div className="px-3 grid grid-cols-3 gap-2 max-w-md mx-auto mt-1">
        <Meter label="SCORE" value={score.toLocaleString()} color="#67e8f9" />
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
              <GemView key={`x${x.id}`} g={{ id: x.id, type: x.type }} r={x.r} c={x.c} cell={cell} removing onDown={() => {}} />
            ))}
          </div>
          {fpToast && (
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-green-300 font-black text-lg pointer-events-none z-30" style={{ textShadow: '0 0 8px #22c55e' }}>{fpToast}</div>
          )}
        </div>
      </div>

      <p className="text-center text-white/50 text-[11px] mt-3">Swipe a gem toward a neighbor · match 3+ · match 4/5 blasts!</p>

      {phase !== 'playing' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6 max-w-md mx-auto">
          <div className="text-center w-full">
            {phase === 'start' && <>
              <h2 className="text-4xl font-black" style={{ color: '#fff', textShadow: '0 0 16px #f0abfc' }}>LANDSLIDE</h2>
              <p className="text-white/70 text-sm mt-2">Clear gems to finish each puzzle. Every level is a new shape.</p>
              <p className="text-pink-200 text-xs mt-3">Saved level: <b className="text-white">{savedLevel}</b> · {designFor(savedLevel).name}</p>
              <button onClick={() => startLevel(savedLevel)} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg" style={{ background: 'radial-gradient(circle at 50% 30%,#f472b6,#be185d)' }}>
                {savedLevel > 0 ? `▶ CONTINUE — LEVEL ${savedLevel}` : '▶ START'}
              </button>
              {savedLevel > 0 && <button onClick={resetToZero} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Reset to Level 0</button>}
            </>}
            {phase === 'won' && <>
              <h2 className="text-3xl font-black text-green-300">PUZZLE {level} CLEARED!</h2>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Meter label="SCORE" value={score.toLocaleString()} color="#67e8f9" />
                <Meter label="FP EARNED" value={`+${fpGame.toLocaleString()}`} color="#4ade80" />
              </div>
              <p className="text-pink-200 text-xs mt-3">Next: <b className="text-white">{designFor(level + 1).name}</b></p>
              <button onClick={nextLevel} className="w-full mt-4 py-3.5 rounded-xl font-black text-lg" style={{ background: 'radial-gradient(circle at 50% 30%,#f472b6,#be185d)' }}>▶ NEXT PUZZLE</button>
            </>}
          </div>
        </div>
      )}

      <style>{`
        @keyframes landBg { 0%,100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }
        @keyframes gemDrop { from { transform: translateY(-560%) } to { transform: translateY(0) } }
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
          filter: selected ? `drop-shadow(0 0 12px ${gem.main}) drop-shadow(0 0 4px #fff)` : 'drop-shadow(0 3px 4px rgba(0,0,0,0.55))',
          animation: g.isNew ? 'gemDrop 0.34s ease-in' : undefined,
        }} />
    </button>
  )
}

function Meter({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="rounded-lg py-1.5 border text-center" style={{ background: 'rgba(0,0,0,0.32)', borderColor: 'rgba(255,255,255,0.14)' }}>
      <div className="text-[8px] tracking-widest text-white/50">{label}</div>
      <div className={`font-black tabular-nums ${small ? 'text-xs' : 'text-base'}`} style={{ color }}>{value}</div>
    </div>
  )
}

'use client'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'

// Landslide — an original match-3 (swap adjacent gems, match 3+, cascades).
// All art/code here is our own.
const COLS = 8, ROWS = 8, TYPES = 6
type Gem = { id: number; type: number; isNew?: boolean }
type Cell = Gem | null
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// vibrant 3D gem palette: [main, deep-shadow] + a faint glyph for accessibility
const GEMS: { main: string; dark: string; glyph: string }[] = [
  { main: '#ff3b6b', dark: '#8a0f2e', glyph: '♥' },
  { main: '#3b82f6', dark: '#1e3a8a', glyph: '★' },
  { main: '#22c55e', dark: '#14532d', glyph: '◆' },
  { main: '#facc15', dark: '#854d0e', glyph: '⬤' },
  { main: '#a855f7', dark: '#581c87', glyph: '▲' },
  { main: '#fb923c', dark: '#7c2d12', glyph: '⬢' },
]

let ID = 1
const newGem = (type: number, isNew = false): Gem => ({ id: ID++, type, isNew })
const rnd = () => Math.floor(Math.random() * TYPES)

function makeBoard(): Cell[][] {
  const b: Cell[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    let t: number
    do { t = rnd() } while (
      (c >= 2 && b[r][c - 1]?.type === t && b[r][c - 2]?.type === t) ||
      (r >= 2 && b[r - 1][c]?.type === t && b[r - 2][c]?.type === t)
    )
    b[r][c] = newGem(t)
  }
  return b
}

// All cells cleared by the current board, including match-4 line blasts and
// match-5 whole-color blasts.
function computeClears(b: Cell[][]): Set<string> {
  const cleared = new Set<string>()
  const blastRC: [number, number][] = []
  const blastType = new Set<number>()
  const scan = (horizontal: boolean) => {
    const outer = horizontal ? ROWS : COLS
    const inner = horizontal ? COLS : ROWS
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
          for (let k = 0; k < len; k++) cleared.add(horizontal ? `${o},${i + k}` : `${i + k},${o}`)
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

function applyGravity(b: Cell[][]) {
  for (let c = 0; c < COLS; c++) {
    const surv: Gem[] = []
    for (let r = 0; r < ROWS; r++) if (b[r][c]) surv.push(b[r][c]!)
    const empty = ROWS - surv.length
    for (let r = 0; r < ROWS; r++) b[r][c] = r < empty ? newGem(rnd(), true) : surv[r - empty]
  }
}

const targetFor = (lvl: number) => 1500 + lvl * 1300
const movesFor = () => 25

export default function LandslidePage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [cell, setCell] = useState(44)
  const [, force] = useState(0)
  const rerender = () => force(v => v + 1)
  const boardRef = useRef<Cell[][]>(makeBoard())
  const [removing, setRemoving] = useState<{ id: number; type: number; r: number; c: number }[]>([])
  const resolving = useRef(false)
  const scoreRef = useRef(0)
  const movesRef = useRef(movesFor())
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)

  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(0)
  const [target, setTarget] = useState(targetFor(0))
  const [moves, setMoves] = useState(movesFor())
  const [phase, setPhase] = useState<'start' | 'playing' | 'won' | 'over'>('start')
  const [savedLevel, setSavedLevel] = useState(0)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpGame, setFpGame] = useState(0)
  const [fpToast, setFpToast] = useState('')

  useEffect(() => {
    for (let i = 0; i < TYPES; i++) { const im = new Image(); im.src = `/gems/gem${i}.png` }
  }, [])
  useEffect(() => { if (profile && balance === null) setBalance(profile.fp_balance) }, [profile, balance])
  useEffect(() => {
    const s = parseInt(localStorage.getItem('landslide_level') || '0', 10)
    if (!isNaN(s)) setSavedLevel(Math.max(0, Math.min(200, s)))
  }, [])
  useEffect(() => {
    const fit = () => {
      const w = Math.min(window.innerWidth, 448) - 16
      const h = window.innerHeight - 210
      setCell(Math.max(30, Math.floor(Math.min(w / COLS, h / ROWS))))
    }
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const fpGameRef = useRef(0)
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

  const commit = () => { boardRef.current = boardRef.current.map(row => row.slice()); rerender() }

  const resolveCascades = useCallback(async (lvl: number) => {
    let combo = 1, gain = 0, total = 0
    while (true) {
      const b = boardRef.current
      const cleared = computeClears(b)
      if (cleared.size === 0) break
      const rem = [...cleared].map(k => {
        const [r, c] = k.split(',').map(Number); const g = b[r][c]!
        return { id: g.id, type: g.type, r, c }
      })
      setRemoving(rem)
      for (const k of cleared) { const [r, c] = k.split(',').map(Number); b[r][c] = null }
      combo >= 3 ? sfx.blast() : sfx.match(combo)
      commit()
      await sleep(210)
      setRemoving([])
      gain += cleared.size * 30 * combo; total += cleared.size
      applyGravity(b); commit()
      await sleep(230)
      combo++
    }
    if (gain > 0) { scoreRef.current += gain; setScore(scoreRef.current); reward('clear', { count: total, level: lvl }) }
    return gain
  }, [])

  const adj = (a: { r: number; c: number }, b: { r: number; c: number }) =>
    Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1

  const trySwap = useCallback(async (a: { r: number; c: number }, b: { r: number; c: number }) => {
    if (resolving.current || phase !== 'playing') return
    resolving.current = true
    const bd = boardRef.current
    ;[bd[a.r][a.c], bd[b.r][b.c]] = [bd[b.r][b.c], bd[a.r][a.c]]
    sfx.swap(); commit(); await sleep(160)
    if (computeClears(bd).size === 0) {
      ;[bd[a.r][a.c], bd[b.r][b.c]] = [bd[b.r][b.c], bd[a.r][a.c]]
      sfx.invalid(); commit(); await sleep(160)
      resolving.current = false; return
    }
    movesRef.current -= 1; setMoves(movesRef.current)
    await resolveCascades(level)
    resolving.current = false
    // win / loss check (refs hold the committed values)
    if (scoreRef.current >= target) winLevel()
    else if (movesRef.current <= 0) { setPhase('over'); sfx.gameOver(); refetch() }
  }, [phase, level, target, resolveCascades]) // eslint-disable-line react-hooks/exhaustive-deps

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
    boardRef.current = makeBoard()
    setSel(null); setRemoving([]); resolving.current = false
    scoreRef.current = 0; movesRef.current = movesFor()
    setScore(0); setLevel(lvl); setTarget(targetFor(lvl)); setMoves(movesFor())
    fpGameRef.current = 0; setFpGame(0)
    commit(); setPhase('playing')
  }
  const nextLevel = () => startLevel(level + 1)
  const resetToZero = () => { localStorage.setItem('landslide_level', '0'); setSavedLevel(0); startLevel(0) }

  function tapCell(r: number, c: number) {
    if (resolving.current || phase !== 'playing') return
    if (!sel) { setSel({ r, c }); return }
    if (sel.r === r && sel.c === c) { setSel(null); return }
    if (adj(sel, { r, c })) { const a = sel; setSel(null); trySwap(a, { r, c }) }
    else setSel({ r, c })
  }

  // swipe: press a gem and drag toward a neighbor to swap (tap-select still works)
  const dragRef = useRef<{ r: number; c: number; x: number; y: number; moved: boolean } | null>(null)
  const onGemDown = (r: number, c: number, e: React.PointerEvent) => {
    if (resolving.current || phase !== 'playing') return
    dragRef.current = { r, c, x: e.clientX, y: e.clientY, moved: false }
    setSel({ r, c })
  }
  const onBoardMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.moved) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.hypot(dx, dy) < cell * 0.4) return
    d.moved = true
    let tr = d.r, tc = d.c
    if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1
    else tr += dy > 0 ? 1 : -1
    dragRef.current = null; setSel(null)
    if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS) trySwap({ r: d.r, c: d.c }, { r: tr, c: tc })
  }
  const onBoardUp = () => {
    const d = dragRef.current
    if (d && !d.moved) tapCell(d.r, d.c)
    dragRef.current = null
  }

  const boardPx = COLS * cell
  const pct = Math.min(100, (score / target) * 100)

  return (
    <div className="min-h-screen text-white relative select-none overflow-hidden"
      style={{ background: 'linear-gradient(135deg,#4c1d95,#831843,#1e3a8a,#312e81)', backgroundSize: '400% 400%', animation: 'landBg 18s ease infinite', fontFamily: 'ui-monospace, monospace' }}>
      {/* header */}
      <div className="px-4 pt-4 pb-1 flex items-center gap-3 relative z-20">
        <button onClick={() => router.push('/arcade')} className="text-white/80 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.12em] text-xl" style={{ color: '#fff', textShadow: '0 0 12px #f0abfc, 0 2px 0 #000' }}>LANDSLIDE</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()}</span>
      </div>

      {/* HUD */}
      <div className="px-3 grid grid-cols-3 gap-2 max-w-md mx-auto mt-1">
        <Meter label="SCORE" value={score.toLocaleString()} color="#67e8f9" />
        <Meter label="MOVES" value={String(moves)} color={moves <= 5 ? '#fca5a5' : '#fff'} />
        <Meter label="LEVEL" value={String(level)} color="#f0abfc" />
      </div>

      {/* target bar */}
      <div className="max-w-md mx-auto px-4 mt-2">
        <div className="text-center text-white/70 text-[11px] mb-1">Goal: {target.toLocaleString()}</div>
        <div className="h-2.5 rounded-full bg-black/40 overflow-hidden border border-white/20">
          <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#facc15,#f472b6,#22d3ee)' }} />
        </div>
      </div>

      {/* board */}
      <div className="flex justify-center mt-3 px-2">
        <div className="relative rounded-2xl p-1.5" style={{ width: boardPx + 12, height: boardPx + 12, background: 'rgba(0,0,0,0.28)', boxShadow: '0 10px 40px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.12)' }}>
          <div className="relative" style={{ width: boardPx, height: boardPx, touchAction: 'none' }}
            onPointerMove={onBoardMove} onPointerUp={onBoardUp} onPointerLeave={onBoardUp}>
            {boardRef.current.map((row, r) => row.map((g, c) => g && (
              <GemView key={g.id} g={g} r={r} c={c} cell={cell}
                selected={!!sel && sel.r === r && sel.c === c}
                onDown={e => onGemDown(r, c, e)} />
            )))}
            {removing.map(x => (
              <GemView key={`x${x.id}`} g={{ id: x.id, type: x.type }} r={x.r} c={x.c} cell={cell} removing onDown={() => {}} />
            ))}
          </div>
          {fpToast && (
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-green-300 font-black text-lg pointer-events-none z-30"
              style={{ textShadow: '0 0 8px #22c55e' }}>{fpToast}</div>
          )}
        </div>
      </div>

      <p className="text-center text-white/50 text-[11px] mt-3">Tap a gem, then a neighbor to swap · match 3+ · match 4/5 blasts!</p>

      {/* overlays */}
      {phase !== 'playing' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6 max-w-md mx-auto">
          <div className="text-center w-full">
            {phase === 'start' && <>
              <h2 className="text-4xl font-black" style={{ color: '#fff', textShadow: '0 0 16px #f0abfc' }}>LANDSLIDE</h2>
              <p className="text-white/70 text-sm mt-2">Match gems, trigger cascades, win a landslide of FP.</p>
              <p className="text-pink-200 text-xs mt-3">Saved level: <b className="text-white">{savedLevel}</b></p>
              <button onClick={() => startLevel(savedLevel)} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                style={{ background: 'radial-gradient(circle at 50% 30%,#f472b6,#be185d)' }}>
                {savedLevel > 0 ? `▶ CONTINUE — LEVEL ${savedLevel}` : '▶ START'}
              </button>
              {savedLevel > 0 && <button onClick={resetToZero} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Reset to Level 0</button>}
            </>}
            {phase === 'won' && <>
              <h2 className="text-3xl font-black text-green-300">LEVEL {level} CLEARED!</h2>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Meter label="SCORE" value={score.toLocaleString()} color="#67e8f9" />
                <Meter label="FP EARNED" value={`+${fpGame.toLocaleString()}`} color="#4ade80" />
              </div>
              <button onClick={nextLevel} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                style={{ background: 'radial-gradient(circle at 50% 30%,#f472b6,#be185d)' }}>▶ NEXT LEVEL</button>
            </>}
            {phase === 'over' && <>
              <h2 className="text-3xl font-black text-red-300">OUT OF MOVES</h2>
              <p className="text-white/70 text-sm mt-1">You reached {score.toLocaleString()} / {target.toLocaleString()}.</p>
              <div className="mt-3"><Meter label="FP EARNED" value={`+${fpGame.toLocaleString()}`} color="#4ade80" /></div>
              <button onClick={() => startLevel(level)} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                style={{ background: 'radial-gradient(circle at 50% 30%,#f472b6,#be185d)' }}>▶ RETRY LEVEL {level}</button>
              <button onClick={resetToZero} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Reset to Level 0</button>
            </>}
          </div>
        </div>
      )}

      <style>{`
        @keyframes landBg { 0%,100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }
        @keyframes gemPop { from { transform: scale(0.3); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      `}</style>
    </div>
  )
}

function GemView({ g, r, c, cell, selected, removing, onDown }:
  { g: Gem; r: number; c: number; cell: number; selected?: boolean; removing?: boolean; onDown: (e: React.PointerEvent) => void }) {
  const gem = GEMS[g.type]
  return (
    <button
      onPointerDown={onDown}
      className="absolute"
      style={{
        left: c * cell, top: r * cell, width: cell, height: cell,
        transition: removing ? 'transform 0.2s ease, opacity 0.2s ease' : 'top 0.24s cubic-bezier(.3,1.2,.5,1), left 0.15s ease, transform 0.12s ease',
        transform: removing ? 'scale(0.1) rotate(20deg)' : selected ? 'scale(1.16)' : 'scale(1)',
        opacity: removing ? 0 : 1,
        zIndex: selected ? 20 : 10,
      }}>
      <img src={`/gems/gem${g.type}.png`} alt="" draggable={false}
        style={{
          width: '100%', height: '100%', objectFit: 'contain',
          filter: selected
            ? `drop-shadow(0 0 12px ${gem.main}) drop-shadow(0 0 4px #fff)`
            : 'drop-shadow(0 3px 4px rgba(0,0,0,0.55))',
          animation: g.isNew ? 'gemPop 0.26s ease-out' : undefined,
        }} />
    </button>
  )
}

function Meter({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg py-1.5 border text-center" style={{ background: 'rgba(0,0,0,0.32)', borderColor: 'rgba(255,255,255,0.14)' }}>
      <div className="text-[8px] tracking-widest text-white/50">{label}</div>
      <div className="font-black text-base tabular-nums" style={{ color }}>{value}</div>
    </div>
  )
}

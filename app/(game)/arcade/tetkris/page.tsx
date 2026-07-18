'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RotateCw, ChevronLeft, ChevronRight, ChevronsDown, ArrowDown, Pause, Play } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/tetkris-sfx'

// Tet-Kris — an original falling-block puzzle. Colors/mechanics are the public
// puzzle genre; all styling and code here are our own.
type Key = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
const PIECES: Record<Key, { m: number[][]; c: string }> = {
  I: { m: [[1, 1, 1, 1]], c: '#22d3ee' },
  O: { m: [[1, 1], [1, 1]], c: '#facc15' },
  T: { m: [[0, 1, 0], [1, 1, 1]], c: '#c084fc' },
  S: { m: [[0, 1, 1], [1, 1, 0]], c: '#4ade80' },
  Z: { m: [[1, 1, 0], [0, 1, 1]], c: '#f87171' },
  J: { m: [[1, 0, 0], [1, 1, 1]], c: '#60a5fa' },
  L: { m: [[0, 0, 1], [1, 1, 1]], c: '#fb923c' },
}
const KEYS: Key[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
const COLS = 10, ROWS = 20
const rotateCW = (m: number[][]) => m[0].map((_, i) => m.map(r => r[i]).reverse())
const emptyBoard = (): (string | null)[][] => Array.from({ length: ROWS }, () => Array(COLS).fill(null))
const shuffled = () => KEYS.slice().sort(() => Math.random() - 0.5)

interface Active { key: Key; m: number[][]; x: number; y: number }
// spark particle from a line clear, in grid units (scaled at draw time)
interface Part { gx: number; gy: number; vx: number; vy: number; born: number; c: string }
// faint starfield behind the well — star-spangled like the lobby key art
const STARS = Array.from({ length: 34 }, () => ({
  x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.6, tw: Math.random() * Math.PI * 2,
}))

export default function TetKrisPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cell, setCell] = useState(28)

  // HUD state
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(0)
  const [goal, setGoal] = useState(2000)
  const [levelScore, setLevelScore] = useState(0)
  const [nextKeys, setNextKeys] = useState<Key[]>([])
  const [holdKey, setHoldKey] = useState<Key | null>(null)
  const [phase, setPhase] = useState<'start' | 'playing' | 'paused' | 'over'>('start')
  const [savedLevel, setSavedLevel] = useState(0)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpGame, setFpGame] = useState(0)
  const [fpToast, setFpToast] = useState('')

  // mutable game data
  const g = useRef({
    board: emptyBoard(),
    cur: null as Active | null,
    queue: [] as Key[],
    hold: null as Key | null,
    canHold: true,
    dropAcc: 0,
    interval: 900,
    last: 0,
    raf: 0,
    score: 0, level: 0, goal: 2000, levelScore: 0,
    running: false, paused: false, fpGame: 0,
    flashRows: [] as number[], parts: [] as Part[], shakeT: 0, shakeMag: 0,
  })
  const [popup, setPopup] = useState<{ text: string; key: number; big: boolean } | null>(null)
  const popupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popupId = useRef(1)
  function showPopup(text: string, big = false) {
    if (popupTimer.current) clearTimeout(popupTimer.current)
    setPopup({ text, big, key: popupId.current++ })
    popupTimer.current = setTimeout(() => setPopup(null), big ? 1100 : 750)
  }

  useEffect(() => {
    if (profile && balance === null) setBalance(profile.fp_balance)
  }, [profile, balance])
  useEffect(() => {
    const s = parseInt(localStorage.getItem('tetkris_level') || '0', 10)
    if (!isNaN(s)) setSavedLevel(Math.max(0, Math.min(20, s)))
  }, [])

  // fit the board to the screen
  useEffect(() => {
    const fit = () => {
      // reserve room for the NEXT/HOLD column (~3.4 cells + gap) and for the
      // header/HUD/progress/controls/bottom-nav chrome (~340px)
      const availW = Math.min(window.innerWidth, 448) - 24
      const availH = window.innerHeight - 340
      const byW = (availW - 12) / (COLS + 3.4)
      const byH = availH / ROWS
      setCell(Math.max(13, Math.floor(Math.min(byW, byH))))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const intervalFor = (lvl: number) => Math.max(80, Math.floor(900 * Math.pow(0.85, lvl)))
  const goalFor = (lvl: number) => 2000 + lvl * 800

  const collide = (board: (string | null)[][], m: number[][], x: number, y: number) => {
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
      if (!m[r][c]) continue
      const nx = x + c, ny = y + r
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true
      if (ny >= 0 && board[ny][nx]) return true
    }
    return false
  }

  const pull = (): Key => {
    if (g.current.queue.length <= 5) g.current.queue.push(...shuffled())
    return g.current.queue.shift()!
  }

  const spawn = useCallback((key?: Key) => {
    const k = key ?? pull()
    const m = PIECES[k].m
    const cur: Active = { key: k, m, x: Math.floor((COLS - m[0].length) / 2), y: 0 }
    g.current.cur = cur
    g.current.canHold = true
    setNextKeys(g.current.queue.slice(0, 3))
    if (collide(g.current.board, cur.m, cur.x, cur.y)) endGame()
  }, [])

  // Server-owned play session (anti-farm): rewards must reference it
  const sessionRef = useRef<string | null>(null)
  const cappedRef = useRef(false)
  useEffect(() => {
    fetch('/api/arcade/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'tetkris' }),
    }).then(r => r.json()).then(d => { sessionRef.current = d.session_id ?? null }).catch(() => {})
  }, [])

  async function reward(event: 'lines' | 'level', extra: { lines?: number; level: number }) {
    try {
      const res = await fetch('/api/arcade/tetkris/reward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...extra, session_id: sessionRef.current }),
      })
      const d = await res.json()
      if (res.ok && d.awarded > 0) {
        g.current.fpGame += d.awarded
        setFpGame(g.current.fpGame)
        setBalance(d.balance)
        setFpToast(`+${d.awarded} FP`)
        setTimeout(() => setFpToast(''), 1200)
      } else if (res.ok && d.capped && !cappedRef.current) {
        cappedRef.current = true
        setFpToast('🏁 Daily arcade FP cap reached — playing for glory!')
        setTimeout(() => setFpToast(''), 2600)
      }
    } catch {}
  }

  const lockPiece = useCallback(() => {
    const gg = g.current
    const cur = gg.cur!
    for (let r = 0; r < cur.m.length; r++) for (let c = 0; c < cur.m[r].length; c++) {
      if (cur.m[r][c] && cur.y + r >= 0) gg.board[cur.y + r][cur.x + c] = PIECES[cur.key].c
    }
    sfx.lock()
    const full: number[] = []
    for (let r = 0; r < ROWS; r++) if (gg.board[r].every(v => v)) full.push(r)
    if (full.length === 0) { spawn(); return }

    // FLASH the full rows, burst sparks, shake — then collapse and score
    gg.cur = null
    gg.flashRows = full
    const now = performance.now()
    gg.shakeT = now + (full.length >= 4 ? 300 : 170)
    gg.shakeMag = 1.5 + full.length
    for (const r of full) for (let c = 0; c < COLS; c += 2) {
      if (gg.parts.length > 110) break
      gg.parts.push({ gx: c + 0.5, gy: r + 0.5, vx: (Math.random() - 0.5) * 7, vy: -2 - Math.random() * 4, born: now, c: gg.board[r][c] || '#fff' })
    }
    sfx.lineClear(full.length)

    setTimeout(() => {
      if (!gg.running) return
      gg.flashRows = []
      let cleared = 0
      for (let r = ROWS - 1; r >= 0; r--) {
        if (gg.board[r].every(v => v)) {
          gg.board.splice(r, 1); gg.board.unshift(Array(COLS).fill(null)); cleared++; r++
        }
      }
      const pts = [0, 100, 300, 500, 800][cleared] * (gg.level + 1)
      gg.score += pts; gg.levelScore += pts
      setScore(gg.score)
      showPopup(cleared >= 4 ? '★ TET-KRIS! ★' : cleared === 3 ? 'TRIPLE!' : cleared === 2 ? 'DOUBLE!' : `+${pts}`, cleared >= 3)
      reward('lines', { lines: cleared, level: gg.level })
      // level up
      let leveled = false
      while (gg.levelScore >= gg.goal) {
        gg.levelScore -= gg.goal
        gg.level += 1
        gg.goal = goalFor(gg.level)
        gg.interval = intervalFor(gg.level)
        leveled = true
        sfx.levelUp()
        reward('level', { level: gg.level })
        if (gg.level > (parseInt(localStorage.getItem('tetkris_level') || '0', 10) || 0)) {
          localStorage.setItem('tetkris_level', String(gg.level))
          setSavedLevel(gg.level)
        }
      }
      if (leveled) showPopup(`LEVEL ${gg.level}!`, true)
      setLevel(gg.level); setGoal(gg.goal); setLevelScore(gg.levelScore)
      spawn()
    }, 170)
  }, [spawn])

  function endGame() {
    g.current.running = false
    setPhase('over')
    sfx.gameOver()
    refetch()
  }

  // ── inputs ────────────────────────────────────────────────────────────────
  const move = useCallback((dx: number) => {
    const gg = g.current; if (!gg.cur || gg.paused || !gg.running) return
    if (!collide(gg.board, gg.cur.m, gg.cur.x + dx, gg.cur.y)) { gg.cur.x += dx; sfx.move() }
  }, [])
  const rotate = useCallback(() => {
    const gg = g.current; if (!gg.cur || gg.paused || !gg.running) return
    const rm = rotateCW(gg.cur.m)
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collide(gg.board, rm, gg.cur.x + kick, gg.cur.y)) { gg.cur.m = rm; gg.cur.x += kick; sfx.rotate(); return }
    }
  }, [])
  const soft = useCallback(() => {
    const gg = g.current; if (!gg.cur || gg.paused || !gg.running) return
    if (!collide(gg.board, gg.cur.m, gg.cur.x, gg.cur.y + 1)) { gg.cur.y += 1; gg.dropAcc = 0; sfx.softDrop() }
    else lockPiece()
  }, [lockPiece])
  const hard = useCallback(() => {
    const gg = g.current; if (!gg.cur || gg.paused || !gg.running) return
    while (!collide(gg.board, gg.cur.m, gg.cur.x, gg.cur.y + 1)) gg.cur.y += 1
    lockPiece()
  }, [lockPiece])
  const doHold = useCallback(() => {
    const gg = g.current; if (!gg.cur || !gg.canHold || gg.paused || !gg.running) return
    const curKey = gg.cur.key
    if (gg.hold) { const h = gg.hold; gg.hold = curKey; spawn(h) }
    else { gg.hold = curKey; spawn() }
    gg.canHold = false
    setHoldKey(gg.hold)
    sfx.hold()
  }, [spawn])

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'playing') return
      const map: Record<string, () => void> = {
        ArrowLeft: () => move(-1), ArrowRight: () => move(1), ArrowUp: rotate,
        ArrowDown: soft, ' ': hard, c: doHold, C: doHold, Shift: doHold,
      }
      if (map[e.key]) { e.preventDefault(); map[e.key]() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, move, rotate, soft, hard, doHold])

  // ── game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const draw = (t: number) => {
      const cv = canvasRef.current; if (!cv) return
      const ctx = cv.getContext('2d')!; const s = cell
      const gg0 = g.current
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.save()
      // impact shake
      if (gg0.shakeT > t) {
        const m = gg0.shakeMag * ((gg0.shakeT - t) / 300)
        ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m)
      }
      // background: deep well + drifting starfield
      const bgGrad = ctx.createLinearGradient(0, 0, 0, ROWS * s)
      bgGrad.addColorStop(0, '#0d0a24'); bgGrad.addColorStop(1, '#070516')
      ctx.fillStyle = bgGrad; ctx.fillRect(-4, -4, COLS * s + 8, ROWS * s + 8)
      for (const st of STARS) {
        ctx.globalAlpha = 0.14 + 0.12 * Math.sin(t / 900 + st.tw)
        ctx.fillStyle = '#e0e7ff'
        ctx.fillRect(st.x * COLS * s, st.y * ROWS * s, st.s, st.s)
      }
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, ROWS * s); ctx.stroke() }
      for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(COLS * s, y * s); ctx.stroke() }
      // 3D beveled cube: lit top/left edges, shadowed bottom/right edges,
      // glossy face — light source top-left
      const block = (px: number, py: number, color: string, alpha = 1) => {
        ctx.globalAlpha = alpha
        const b = Math.max(2, s * 0.17) // bevel width
        const x0 = px + 1, y0 = py + 1, x1 = px + s - 1, y1 = py + s - 1
        // face
        const grad = ctx.createLinearGradient(x0, y0, x1, y1)
        grad.addColorStop(0, shade(color, 8)); grad.addColorStop(1, shade(color, -34))
        ctx.fillStyle = grad
        ctx.fillRect(x0, y0, s - 2, s - 2)
        // top bevel (brightest)
        ctx.fillStyle = shade(color, 55)
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1 - b, y0 + b); ctx.lineTo(x0 + b, y0 + b); ctx.closePath(); ctx.fill()
        // left bevel (bright)
        ctx.fillStyle = shade(color, 28)
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + b, y0 + b); ctx.lineTo(x0 + b, y1 - b); ctx.lineTo(x0, y1); ctx.closePath(); ctx.fill()
        // bottom bevel (darkest)
        ctx.fillStyle = shade(color, -55)
        ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1 - b, y1 - b); ctx.lineTo(x0 + b, y1 - b); ctx.closePath(); ctx.fill()
        // right bevel (dark)
        ctx.fillStyle = shade(color, -38)
        ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 - b, y1 - b); ctx.lineTo(x1 - b, y0 + b); ctx.closePath(); ctx.fill()
        // specular gloss on the face
        ctx.fillStyle = 'rgba(255,255,255,0.28)'
        ctx.beginPath()
        ctx.ellipse(x0 + (s - 2) * 0.34, y0 + (s - 2) * 0.3, (s - 2) * 0.2, (s - 2) * 0.11, -0.5, 0, Math.PI * 2)
        ctx.fill()
        // crisp outline
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.strokeRect(x0, y0, s - 2, s - 2)
        ctx.globalAlpha = 1
      }
      const gg = g.current
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (gg.board[r][c]) block(c * s, r * s, gg.board[r][c]!)
      if (gg.cur) {
        // ghost
        let gy = gg.cur.y
        while (!collide(gg.board, gg.cur.m, gg.cur.x, gy + 1)) gy++
        for (let r = 0; r < gg.cur.m.length; r++) for (let c = 0; c < gg.cur.m[r].length; c++)
          if (gg.cur.m[r][c]) block((gg.cur.x + c) * s, (gy + r) * s, PIECES[gg.cur.key].c, 0.18)
        for (let r = 0; r < gg.cur.m.length; r++) for (let c = 0; c < gg.cur.m[r].length; c++)
          if (gg.cur.m[r][c] && gg.cur.y + r >= 0) block((gg.cur.x + c) * s, (gg.cur.y + r) * s, PIECES[gg.cur.key].c)
      }
      // line-clear flash: full rows blaze white for a beat before collapsing
      for (const fr of gg.flashRows) {
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t / 26)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, fr * s, COLS * s, s)
        ctx.globalAlpha = 1
      }
      // clear-burst sparks
      if (gg.parts.length) {
        gg.parts = gg.parts.filter(p => t - p.born < 520)
        for (const p of gg.parts) {
          const age = (t - p.born) / 1000
          const px = (p.gx + p.vx * age) * s, py = (p.gy + (p.vy * age + 14 * age * age)) * s
          ctx.globalAlpha = Math.max(0, 1 - age / 0.52)
          ctx.fillStyle = p.c
          ctx.fillRect(px - 2, py - 2, 4, 4)
        }
        ctx.globalAlpha = 1
      }
      // danger vignette when the stack breaches the top rows
      let top = ROWS
      outer: for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (gg.board[r][c]) { top = r; break outer }
      if (top <= 4 && gg.running) {
        const dg = ctx.createLinearGradient(0, 0, 0, 5 * s)
        dg.addColorStop(0, `rgba(239,68,68,${0.22 + 0.14 * Math.sin(t / 220)})`); dg.addColorStop(1, 'rgba(239,68,68,0)')
        ctx.fillStyle = dg; ctx.fillRect(0, 0, COLS * s, 5 * s)
      }
      ctx.restore()
    }
    const loop = (t: number) => {
      const gg = g.current
      if (gg.running && !gg.paused) {
        if (!gg.last) gg.last = t
        gg.dropAcc += t - gg.last; gg.last = t
        if (gg.dropAcc >= gg.interval) {
          gg.dropAcc = 0
          if (gg.cur && !collide(gg.board, gg.cur.m, gg.cur.x, gg.cur.y + 1)) gg.cur.y += 1
          else if (gg.cur) lockPiece()
        }
      } else { gg.last = t }
      draw(t)
      g.current.raf = requestAnimationFrame(loop)
    }
    g.current.raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(g.current.raf)
  }, [cell, lockPiece])

  function start(fromLevel: number) {
    const gg = g.current
    gg.board = emptyBoard(); gg.queue = shuffled(); gg.hold = null; gg.canHold = true
    gg.score = 0; gg.levelScore = 0; gg.level = fromLevel; gg.goal = goalFor(fromLevel)
    gg.interval = intervalFor(fromLevel); gg.dropAcc = 0; gg.last = 0; gg.fpGame = 0
    gg.flashRows = []; gg.parts = []; gg.shakeT = 0
    gg.running = true; gg.paused = false
    setPopup(null)
    setScore(0); setLevel(fromLevel); setGoal(gg.goal); setLevelScore(0)
    setHoldKey(null); setFpGame(0)
    spawn()
    setPhase('playing')
  }

  function resetToZero() {
    localStorage.setItem('tetkris_level', '0'); setSavedLevel(0); start(0)
  }
  function togglePause() {
    if (phase === 'playing') { g.current.paused = true; setPhase('paused') }
    else if (phase === 'paused') { g.current.paused = false; g.current.last = 0; setPhase('playing') }
  }

  const boardW = COLS * cell, boardH = ROWS * cell

  return (
    <div className="min-h-screen text-white relative select-none overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% -10%, #2a1a4a 0%, #0a0616 60%, #050208 100%)', fontFamily: 'ui-monospace, monospace' }}>
      {/* header */}
      <div className="px-4 pt-4 pb-1 flex items-center gap-3 relative z-20">
        <button onClick={() => router.push('/arcade')} className="text-purple-300 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.15em] text-xl"
          style={{ color: '#facc15', textShadow: '0 0 10px #a855f7' }}>TET-KRIS</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()}</span>
        {phase !== 'start' && phase !== 'over' && (
          <button onClick={togglePause} className="text-purple-200 hover:text-white">
            {phase === 'paused' ? <Play size={18} /> : <Pause size={18} />}
          </button>
        )}
      </div>

      {/* HUD */}
      <div className="px-4 flex items-stretch gap-2 max-w-md mx-auto mt-1">
        <Meter label="SCORE" value={score.toLocaleString()} color="#22d3ee" />
        <Meter label="LEVEL" value={String(level)} color="#c084fc" />
        <Meter label="GOAL" value={goal.toLocaleString()} color="#f472b6" />
      </div>

      {/* board + side panels */}
      <div className="flex justify-center gap-3 mt-2 px-3" style={{ perspective: 900 }}>
        {/* the well leans back slightly — a 3D cabinet face, not a flat sheet */}
        <div className="relative rounded-lg overflow-hidden" style={{
          transform: 'rotateX(5deg)', transformOrigin: '50% 0%',
          boxShadow: '0 0 24px rgba(168,85,247,0.45), 0 16px 26px -8px rgba(0,0,0,0.85), inset 0 2px 0 rgba(255,255,255,0.18)',
          border: '2px solid #7c3aed',
          borderTopColor: '#a78bfa', borderBottomColor: '#4c1d95',
        }}>
          <canvas ref={canvasRef} width={boardW} height={boardH} style={{ width: boardW, height: boardH, display: 'block' }}
            onClick={rotate} />
          {fpToast && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-green-300 font-black text-lg pointer-events-none whitespace-nowrap"
              style={{ textShadow: '0 0 8px #22c55e' }}>{fpToast}</div>
          )}
          {popup && (
            <div key={popup.key} className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div className={`font-black ${popup.big ? 'text-3xl' : 'text-xl'} whitespace-nowrap`} style={{
                color: '#fff', textShadow: '0 0 16px #c084fc, 0 0 5px #fff, 0 3px 0 #000',
                animation: 'tkPop 0.7s cubic-bezier(.2,1.6,.4,1) forwards',
              }}>{popup.text}</div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2" style={{ width: cell * 3.4 }}>
          <Panel label="NEXT">
            <div className="flex flex-col gap-1.5">
              {nextKeys.map((k, i) => <MiniPiece key={i} k={k} />)}
            </div>
          </Panel>
          <Panel label="HOLD"><MiniPiece k={holdKey} /></Panel>
          {/* hard drop lives here, under HOLD — far from the movement cluster
              so a thumb reaching for ←/→ can't slam a piece by accident */}
          <Btn onClick={hard} accent className="py-4">
            <ChevronsDown size={22} /> <span className="text-xs font-black">DROP</span>
          </Btn>
        </div>
      </div>

      {/* progress bar */}
      <div className="max-w-md mx-auto px-4 mt-3">
        <div className="text-center text-white/60 text-xs mb-1">{levelScore.toLocaleString()} / {goal.toLocaleString()}</div>
        <div className="h-3 rounded-full bg-black/50 overflow-hidden border border-purple-800">
          <div className="h-full transition-all" style={{ width: `${Math.min(100, (levelScore / goal) * 100)}%`, background: 'linear-gradient(90deg,#ec4899,#f59e0b)' }} />
        </div>
      </div>

      {/* controls — centered movement cluster; hard drop lives up by HOLD */}
      <div className="mx-auto mt-3 pb-4 px-4" style={{ maxWidth: 320 }}>
        <div className="grid grid-cols-3 gap-2">
          <Btn onClick={() => move(-1)}><ChevronLeft size={22} /></Btn>
          <Btn onClick={rotate}><RotateCw size={20} /></Btn>
          <Btn onClick={() => move(1)}><ChevronRight size={22} /></Btn>
          <Btn onClick={soft} className="col-span-2"><ArrowDown size={20} /> <span className="text-xs">SOFT DROP</span></Btn>
          <Btn onClick={doHold}><span className="text-xs font-black">HOLD</span></Btn>
        </div>
      </div>

      {/* overlays */}
      {(phase === 'start' || phase === 'over' || phase === 'paused') && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 backdrop-blur-sm px-6 max-w-md mx-auto">
          <div className="text-center w-full">
            {phase === 'start' && <>
              <h2 className="text-4xl font-black" style={{ color: '#facc15', textShadow: '0 0 14px #a855f7' }}>TET-KRIS</h2>
              <p className="text-white/70 text-sm mt-2">Clear rows to earn FP. Pass levels for big bonuses.</p>
              <p className="text-purple-300 text-xs mt-3">Saved level: <b className="text-white">{savedLevel}</b></p>
              <button onClick={() => start(savedLevel)} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                style={{ background: 'radial-gradient(circle at 50% 30%, #a855f7, #6d28d9)' }}>
                {savedLevel > 0 ? `▶ CONTINUE — LEVEL ${savedLevel}` : '▶ START'}
              </button>
              {savedLevel > 0 && <button onClick={resetToZero} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Reset to Level 0</button>}
            </>}
            {phase === 'over' && <>
              <h2 className="text-3xl font-black text-red-400" style={{ textShadow: '0 0 14px #ef4444' }}>TERM LIMITED!</h2>
              <p className="text-white/60 text-xs mt-1">The stack reached the top.</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Meter label="SCORE" value={score.toLocaleString()} color="#22d3ee" />
                <Meter label="LEVEL" value={String(level)} color="#c084fc" />
                <Meter label="FP EARNED" value={`+${fpGame.toLocaleString()}`} color="#4ade80" />
              </div>
              <button onClick={() => start(savedLevel)} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                style={{ background: 'radial-gradient(circle at 50% 30%, #a855f7, #6d28d9)' }}>▶ PLAY AGAIN</button>
              <button onClick={resetToZero} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Reset to Level 0</button>
            </>}
            {phase === 'paused' && <>
              <h2 className="text-3xl font-black text-purple-300">PAUSED</h2>
              <button onClick={togglePause} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                style={{ background: 'radial-gradient(circle at 50% 30%, #a855f7, #6d28d9)' }}>▶ RESUME</button>
            </>}
          </div>
        </div>
      )}

      <style>{`
        @keyframes tkPop { 0% { transform: scale(0.3); opacity: 0 } 25% { transform: scale(1.15); opacity: 1 } 75% { transform: scale(1); opacity: 1 } 100% { transform: scale(1); opacity: 0 } }
      `}</style>
    </div>
  )
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, (n >> 16) + amt))
  const gc = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
  const b = Math.max(0, Math.min(255, (n & 255) + amt))
  return `rgb(${r},${gc},${b})`
}

function Meter({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex-1 rounded-lg py-1.5 border text-center" style={{ background: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.08)' }}>
      <div className="text-[8px] tracking-widest text-white/45">{label}</div>
      <div className="font-black text-base tabular-nums" style={{ color }}>{value}</div>
    </div>
  )
}
function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-purple-900 bg-black/40 p-2">
      <div className="text-[9px] tracking-widest text-white/50 text-center mb-1.5">{label}</div>
      {children}
    </div>
  )
}
function MiniPiece({ k }: { k: Key | null }) {
  if (!k) return <div className="h-6" />
  const m = PIECES[k].m
  return (
    <div className="flex flex-col items-center gap-0.5">
      {m.map((row, r) => (
        <div key={r} className="flex gap-0.5">
          {row.map((v, c) => (
            <div key={c} className="w-3 h-3 rounded-[2px]" style={v ? {
              background: `linear-gradient(135deg, ${PIECES[k].c}, ${PIECES[k].c})`,
              boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.55), inset -1px -1px 0 rgba(0,0,0,0.5)',
            } : { background: 'transparent' }} />
          ))}
        </div>
      ))}
    </div>
  )
}
function Btn({ onClick, children, className = '', accent }: { onClick: () => void; children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex items-center justify-center gap-1 py-3.5 rounded-xl font-bold active:scale-95 transition ${className}`}
      style={{ background: accent ? 'linear-gradient(180deg,#22c55e,#15803d)' : 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
      {children}
    </button>
  )
}

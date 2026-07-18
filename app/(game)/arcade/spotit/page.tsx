'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'
import POOL from '@/config/spotit-pool.json'

// Barroom Eyes — spot the differences, like the machines at the bar.
// RANDOMIZED: each scene ships as ONE base image plus a pool of ~40 verified
// spots (config/spotit-pool.json, scored offline for visibility). Every round
// picks 6 random spots and paints the color-shifts onto the second copy in a
// canvas — so the differences are different every time you play.
// Tap a difference on EITHER copy. Wrong taps cost 5s. 25 FP/find, 100 bonus.

type PoolScene = { id: string; label: string; w: number; h: number; pool: { x: number; y: number; r: number }[] }
type Diff = { x: number; y: number; r: number; deg: number }
const BANK = POOL as PoolScene[]
const DIFFS_PER_ROUND = 6
const SCENE_TIME = 120
const TAP_SLACK = 1.6 // multiplier on key radius for finger accuracy

// standard feColorMatrix hueRotate coefficients (same math as the pool builder)
function hueMatrix(deg: number) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}

function rollDiffs(scene: PoolScene): Diff[] {
  const pool = [...scene.pool]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, DIFFS_PER_ROUND).map(p => ({ ...p, deg: 90 + Math.random() * 180 }))
}

export default function SpotItPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [sceneIdx, setSceneIdx] = useState(0)
  const [diffs, setDiffs] = useState<Diff[]>([])
  const [round, setRound] = useState(0) // bump = repaint canvas
  const [phase, setPhase] = useState<'start' | 'playing' | 'won' | 'lost'>('start')
  const [found, setFound] = useState<number[]>([])
  const [timeLeft, setTimeLeft] = useState(SCENE_TIME)
  const [wrongMark, setWrongMark] = useState<{ x: number; y: number; img: 'a' | 'b'; key: number } | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpToast, setFpToast] = useState('')
  const [fpGame, setFpGame] = useState(0)
  const [hintsLeft, setHintsLeft] = useState(2)
  const [hintMark, setHintMark] = useState<{ k: number; key: number } | null>(null)
  const penaltyRef = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const scene = BANK[sceneIdx % BANK.length]

  useEffect(() => { if (profile && balance === null) setBalance(profile.fp_balance) }, [profile, balance])
  useEffect(() => {
    const s = parseInt(localStorage.getItem('spotit_scene') || '0', 10)
    const idx = isNaN(s) ? 0 : s % BANK.length
    setSceneIdx(idx)
    setDiffs(rollDiffs(BANK[idx]))
  }, [])

  const sessionRef = useRef<string | null>(null)
  const cappedRef = useRef(false)
  useEffect(() => {
    fetch('/api/arcade/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'spotit' }),
    }).then(r => r.json()).then(d => { sessionRef.current = d.session_id ?? null }).catch(() => {})
  }, [])

  // paint the altered copy: base image + this round's hue-shift circles.
  // Manual per-pixel hue rotation (no ctx.filter — Safari support is spotty),
  // feathered at the circle edge so shifts blend naturally.
  useEffect(() => {
    if (!diffs.length) return
    const img = new Image()
    img.src = `/spotit/${scene.id}_a.jpg`
    img.onload = () => {
      const cv = canvasRef.current
      if (!cv) return
      cv.width = img.naturalWidth; cv.height = img.naturalHeight
      const ctx = cv.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const W = cv.width, H = cv.height
      for (const d of diffs) {
        const pr = Math.round(d.r * W)
        const px = Math.round(d.x * W), py = Math.round(d.y * H)
        const x0 = Math.max(0, px - pr), y0 = Math.max(0, py - pr)
        const w = Math.min(W, px + pr) - x0, h = Math.min(H, py + pr) - y0
        const patch = ctx.getImageData(x0, y0, w, h)
        const M = hueMatrix(d.deg)
        const feather = pr * 0.32
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dist = Math.hypot(x0 + x - px, y0 + y - py)
            if (dist > pr) continue
            const f = Math.min(1, (pr - dist) / feather)
            const i = (y * w + x) * 4
            const r = patch.data[i], g = patch.data[i + 1], b = patch.data[i + 2]
            patch.data[i] = r + f * (M[0] * r + M[1] * g + M[2] * b - r)
            patch.data[i + 1] = g + f * (M[3] * r + M[4] * g + M[5] * b - g)
            patch.data[i + 2] = b + f * (M[6] * r + M[7] * g + M[8] * b - b)
          }
        }
        ctx.putImageData(patch, x0, y0)
      }
    }
  }, [scene.id, diffs, round])

  useEffect(() => {
    if (phase !== 'playing') return
    const t = setInterval(() => {
      setTimeLeft(v => {
        const next = v - 1 - penaltyRef.current
        penaltyRef.current = 0
        if (next <= 0) { clearInterval(t); setPhase('lost'); sfx.gameOver(); return 0 }
        return next
      })
    }, 1000)
    return () => clearInterval(t)
  }, [phase])

  async function reward(event: 'find' | 'scene') {
    try {
      const res = await fetch('/api/arcade/spotit/reward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, session_id: sessionRef.current }),
      })
      const d = await res.json()
      if (res.ok && d.awarded > 0) {
        setFpGame(g => g + d.awarded)
        setBalance(d.balance); sfx.coin()
        setFpToast(`+${d.awarded} FP`); setTimeout(() => setFpToast(''), 1100)
      } else if (res.ok && d.capped && !cappedRef.current) {
        cappedRef.current = true
        setFpToast('🏁 Daily arcade FP cap reached — playing for glory!')
        setTimeout(() => setFpToast(''), 2600)
      }
    } catch {}
  }

  function freshRound(idx: number) {
    setDiffs(rollDiffs(BANK[idx % BANK.length]))
    setRound(r => r + 1)
    setFound([]); setTimeLeft(SCENE_TIME); setFpGame(0); penaltyRef.current = 0
    setHintsLeft(2); setHintMark(null)
    setPhase('playing')
  }
  const start = () => freshRound(sceneIdx)
  function nextScene() {
    const n = (sceneIdx + 1) % BANK.length
    localStorage.setItem('spotit_scene', String(n))
    setSceneIdx(n)
    freshRound(n)
  }

  // 2 hints per round: flash a golden ring around one unfound difference
  function useHint() {
    if (phase !== 'playing' || hintsLeft <= 0 || hintMark) return
    const unfound = diffs.map((_, k) => k).filter(k => !found.includes(k))
    if (!unfound.length) return
    const k = unfound[Math.floor(Math.random() * unfound.length)]
    setHintsLeft(h => h - 1)
    setHintMark({ k, key: Date.now() })
    sfx.swap()
    setTimeout(() => setHintMark(null), 2200)
  }

  function tap(img: 'a' | 'b', e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'playing') return
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    for (let k = 0; k < diffs.length; k++) {
      if (found.includes(k)) continue
      const d = diffs[k]
      const dx = (nx - d.x) * scene.w, dy = (ny - d.y) * scene.h
      if (Math.hypot(dx, dy) <= d.r * scene.w * TAP_SLACK) {
        const nf = [...found, k]
        setFound(nf); sfx.match(1)
        reward('find')
        if (nf.length === diffs.length) {
          setPhase('won'); sfx.levelUp(); reward('scene'); refetch()
        }
        return
      }
    }
    // miss — 5s penalty
    penaltyRef.current += 5
    setWrongMark({ x: nx, y: ny, img, key: Date.now() })
    sfx.invalid()
    setTimeout(() => setWrongMark(null), 700)
  }

  const overlays = (which: 'a' | 'b') => (
    <>
      {found.map(k => {
        const d = diffs[k]
        return (
          <div key={k} className="absolute rounded-full pointer-events-none" style={{
            left: `${(d.x - d.r) * 100}%`, top: `${(d.y - d.r * (scene.w / scene.h)) * 100}%`,
            width: `${d.r * 2 * 100}%`, paddingBottom: `${d.r * 2 * 100}%`,
            border: '3px solid #4ade80', boxShadow: '0 0 12px #22c55e, inset 0 0 8px rgba(34,197,94,0.4)',
            animation: 'foundPop 0.4s cubic-bezier(.2,1.6,.4,1)',
          }} />
        )
      })}
      {wrongMark && wrongMark.img === which && (
        <div className="absolute pointer-events-none font-black text-2xl text-red-500" style={{
          left: `${wrongMark.x * 100}%`, top: `${wrongMark.y * 100}%`, transform: 'translate(-50%,-50%)',
          textShadow: '0 0 8px #000', animation: 'wrongFade 0.7s ease-out forwards',
        }}>✕ -5s</div>
      )}
      {/* hint: golden pulse around an unfound difference (both copies) */}
      {hintMark && !found.includes(hintMark.k) && (() => {
        const d = diffs[hintMark.k]
        const rr = d.r * 1.5
        return (
          <div key={hintMark.key} className="absolute rounded-full pointer-events-none" style={{
            left: `${(d.x - rr) * 100}%`, top: `${(d.y - rr * (scene.w / scene.h)) * 100}%`,
            width: `${rr * 2 * 100}%`, paddingBottom: `${rr * 2 * 100}%`,
            border: '4px solid #fbbf24', boxShadow: '0 0 16px #f59e0b, inset 0 0 12px rgba(251,191,36,0.5)',
            animation: 'hintRing 2.2s ease-out forwards',
          }} />
        )
      })()}
    </>
  )

  return (
    <div className="min-h-screen text-white relative select-none pb-8"
      style={{ background: 'radial-gradient(circle at 50% 0%, #1e3a5f, #101c2e 55%, #0a1220)', fontFamily: 'ui-monospace, monospace' }}>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.push('/arcade')} className="text-white/70 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.12em] text-lg" style={{ color: '#7dd3fc', textShadow: '0 0 12px #0ea5e9, 0 2px 0 #000' }}>BARROOM EYES</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()}</span>
      </div>

      <div className="max-w-md mx-auto px-4 flex items-center justify-between text-[13px] font-black">
        <span style={{ color: '#7dd3fc' }}>🔍 {scene.label.toUpperCase()}</span>
        <span className={timeLeft <= 20 ? 'text-red-400' : 'text-white/80'}
          style={{ animation: phase === 'playing' && timeLeft <= 20 ? 'meterPulse 0.9s ease-in-out infinite' : undefined }}>
          ⏱ {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
        </span>
        <span className="text-green-300">{found.length}/{diffs.length || DIFFS_PER_ROUND} FOUND</span>
      </div>

      {/* hint + skip row */}
      <div className="max-w-md mx-auto px-4 mt-1.5 flex items-center justify-center gap-2">
        <button onClick={useHint} disabled={phase !== 'playing' || hintsLeft <= 0 || !!hintMark}
          className="flex-1 py-2 rounded-full font-black text-[13px] transition active:scale-95 disabled:opacity-35"
          style={{ background: 'rgba(251,191,36,0.14)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.4)' }}>
          💡 HINT ({hintsLeft} left)
        </button>
        <button onClick={nextScene} disabled={phase === 'won'}
          className="flex-1 py-2 rounded-full font-black text-[13px] transition active:scale-95 disabled:opacity-35"
          style={{ background: 'rgba(125,211,252,0.12)', color: '#7dd3fc', border: '1px solid rgba(125,211,252,0.35)' }}>
          NEXT PUZZLE ⏭
        </button>
      </div>

      <div className="max-w-md mx-auto px-3 mt-2 space-y-2 relative">
        {/* original */}
        <div className="relative rounded-xl overflow-hidden select-none" style={{ border: '2px solid rgba(255,255,255,0.15)', touchAction: 'manipulation' }}
          onPointerDown={e => tap('a', e)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/spotit/${scene.id}_a.jpg`} alt="" draggable={false} className="w-full block" />
          {overlays('a')}
        </div>
        {/* altered copy — painted fresh each round */}
        <div className="relative rounded-xl overflow-hidden select-none" style={{ border: '2px solid rgba(255,255,255,0.15)', touchAction: 'manipulation' }}
          onPointerDown={e => tap('b', e)}>
          <canvas ref={canvasRef} className="w-full block" style={{ aspectRatio: `${scene.w} / ${scene.h}` }} />
          {overlays('b')}
        </div>

        {fpToast && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-green-300 font-black text-2xl pointer-events-none z-30 whitespace-nowrap"
            style={{ textShadow: '0 0 10px #22c55e, 0 2px 4px #000' }}>{fpToast}</div>
        )}

        {phase !== 'playing' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl px-6"
            style={{ background: 'rgba(6,12,24,0.82)', backdropFilter: 'blur(3px)' }}>
            <div className="text-center w-full">
              {phase === 'start' && <>
                <h2 className="text-3xl font-black" style={{ color: '#7dd3fc', textShadow: '0 0 16px #0ea5e9' }}>BARROOM EYES</h2>
                <p className="text-white/70 text-sm mt-2">Two pictures. {DIFFS_PER_ROUND} differences — new ones every round. Tap them on either picture; wrong taps cost 5 seconds.</p>
                <p className="text-white/50 text-xs mt-1.5">25 FP per find · {DIFFS_PER_ROUND * 25 + 100} FP for a clean sweep</p>
                <button onClick={start} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#38bdf8,#0369a1)' }}>▶ START</button>
              </>}
              {phase === 'won' && <>
                <h2 className="text-3xl font-black text-green-300" style={{ textShadow: '0 0 14px #22c55e' }}>EAGLE EYES!</h2>
                <p className="text-white/60 text-xs mt-1">{scene.label} cleared with {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')} to spare · +{fpGame} FP</p>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button onClick={start} className="py-3 rounded-xl font-black text-sm bg-white/10">↻ SAME SCENE<br /><span className="font-bold text-[10px] text-white/50">new differences</span></button>
                  <button onClick={nextScene} className="py-3 rounded-xl font-black text-sm"
                    style={{ background: 'radial-gradient(circle at 50% 30%,#38bdf8,#0369a1)' }}>NEXT SCENE ▶</button>
                </div>
              </>}
              {phase === 'lost' && <>
                <h2 className="text-3xl font-black text-red-400" style={{ textShadow: '0 0 14px #ef4444' }}>TIME&apos;S UP</h2>
                <p className="text-white/70 text-sm mt-2">{found.length}/{diffs.length} found · +{fpGame} FP kept</p>
                <button onClick={start} className="w-full mt-4 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#f87171,#b91c1c)' }}>↻ TRY AGAIN (new differences)</button>
                <button onClick={nextScene} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Skip to next scene</button>
              </>}
            </div>
          </div>
        )}
      </div>

      <p className="text-center text-white/40 text-[11px] mt-3">Find every difference before the clock runs out — they move every round.</p>

      <style>{`
        @keyframes foundPop { 0% { transform: scale(0.3); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
        @keyframes hintRing { 0% { transform: scale(1.6); opacity: 0 } 15% { opacity: 1 } 80% { transform: scale(1); opacity: 1 } 100% { opacity: 0 } }
        @keyframes wrongFade { 0% { opacity: 1 } 100% { opacity: 0; transform: translate(-50%,-90%) } }
        @keyframes meterPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.1) } }
      `}</style>
    </div>
  )
}

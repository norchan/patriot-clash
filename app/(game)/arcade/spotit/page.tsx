'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'
import SCENES from '@/config/spotit.json'

// Barroom Eyes — spot the differences, like the machines at the bar.
// Two copies of a scene, 6 baked-in differences (config/spotit.json holds the
// exact answer key, generated with the images). Tap a difference on EITHER
// copy. Wrong taps cost 5 seconds. 25 FP per find, 100 FP scene bonus.

type Scene = { id: string; label: string; w: number; h: number; diffs: { x: number; y: number; r: number }[] }
const BANK = SCENES as Scene[]
const SCENE_TIME = 120
const TAP_SLACK = 1.6 // multiplier on key radius for finger accuracy

export default function SpotItPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [sceneIdx, setSceneIdx] = useState(0)
  const [phase, setPhase] = useState<'start' | 'playing' | 'won' | 'lost'>('start')
  const [found, setFound] = useState<number[]>([])
  const [timeLeft, setTimeLeft] = useState(SCENE_TIME)
  const [wrongMark, setWrongMark] = useState<{ x: number; y: number; img: 'a' | 'b'; key: number } | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpToast, setFpToast] = useState('')
  const [fpGame, setFpGame] = useState(0)
  const penaltyRef = useRef(0)

  const scene = BANK[sceneIdx % BANK.length]

  useEffect(() => { if (profile && balance === null) setBalance(profile.fp_balance) }, [profile, balance])
  useEffect(() => {
    const s = parseInt(localStorage.getItem('spotit_scene') || '0', 10)
    if (!isNaN(s)) setSceneIdx(s % BANK.length)
  }, [])

  const sessionRef = useRef<string | null>(null)
  const cappedRef = useRef(false)
  useEffect(() => {
    fetch('/api/arcade/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'spotit' }),
    }).then(r => r.json()).then(d => { sessionRef.current = d.session_id ?? null }).catch(() => {})
  }, [])

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

  function start() {
    setFound([]); setTimeLeft(SCENE_TIME); setFpGame(0); penaltyRef.current = 0
    setPhase('playing')
  }
  function nextScene() {
    const n = (sceneIdx + 1) % BANK.length
    localStorage.setItem('spotit_scene', String(n))
    setSceneIdx(n)
    setFound([]); setTimeLeft(SCENE_TIME); setFpGame(0); penaltyRef.current = 0
    setPhase('playing')
  }

  function tap(img: 'a' | 'b', e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'playing') return
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    for (let k = 0; k < scene.diffs.length; k++) {
      if (found.includes(k)) continue
      const d = scene.diffs[k]
      const dx = (nx - d.x) * scene.w, dy = (ny - d.y) * scene.h
      if (Math.hypot(dx, dy) <= d.r * scene.w * TAP_SLACK) {
        const nf = [...found, k]
        setFound(nf); sfx.match(1)
        reward('find')
        if (nf.length === scene.diffs.length) {
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

  const Panel = ({ which }: { which: 'a' | 'b' }) => (
    <div className="relative rounded-xl overflow-hidden select-none" style={{ border: '2px solid rgba(255,255,255,0.15)', touchAction: 'manipulation' }}
      onPointerDown={e => tap(which, e)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/spotit/${scene.id}_${which}.jpg`} alt="" draggable={false} className="w-full block" />
      {found.map(k => {
        const d = scene.diffs[k]
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
    </div>
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
        <span className="text-green-300">{found.length}/{scene.diffs.length} FOUND</span>
      </div>

      <div className="max-w-md mx-auto px-3 mt-2 space-y-2 relative">
        <Panel which="a" />
        <Panel which="b" />
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
                <p className="text-white/70 text-sm mt-2">Two pictures. {scene.diffs.length} differences. Tap them on either picture — wrong taps cost 5 seconds.</p>
                <p className="text-white/50 text-xs mt-1.5">25 FP per find · {scene.diffs.length * 25 + 100} FP for a clean sweep</p>
                <button onClick={start} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#38bdf8,#0369a1)' }}>▶ START</button>
              </>}
              {phase === 'won' && <>
                <h2 className="text-3xl font-black text-green-300" style={{ textShadow: '0 0 14px #22c55e' }}>EAGLE EYES!</h2>
                <p className="text-white/60 text-xs mt-1">{scene.label} cleared with {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')} to spare · +{fpGame} FP</p>
                <button onClick={nextScene} className="w-full mt-4 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#38bdf8,#0369a1)' }}>▶ NEXT SCENE</button>
              </>}
              {phase === 'lost' && <>
                <h2 className="text-3xl font-black text-red-400" style={{ textShadow: '0 0 14px #ef4444' }}>TIME&apos;S UP</h2>
                <p className="text-white/70 text-sm mt-2">{found.length}/{scene.diffs.length} found · +{fpGame} FP kept</p>
                <button onClick={start} className="w-full mt-4 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#f87171,#b91c1c)' }}>↻ TRY AGAIN</button>
                <button onClick={nextScene} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Skip to next scene</button>
              </>}
            </div>
          </div>
        )}
      </div>

      <p className="text-center text-white/40 text-[11px] mt-3">Find every difference before the clock runs out.</p>

      <style>{`
        @keyframes foundPop { 0% { transform: scale(0.3); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
        @keyframes wrongFade { 0% { opacity: 1 } 100% { opacity: 0; transform: translate(-50%,-90%) } }
        @keyframes meterPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.1) } }
      `}</style>
    </div>
  )
}

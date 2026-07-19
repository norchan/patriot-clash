'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'
import SCENES from '@/config/spotit-scenes.json'

// Pic Hunt — spot the differences, like the machines at the bar.
// v3 (Michael's spec): every scene ships as ONE original + ~20 PRE-BAKED
// copies, each carrying 6 differences. A round loads the original and one
// copy — nothing is painted on the fly, so there are no rendering tells.
// Differences are chroma-masked recolors on big objects (phone-visible).

type Variant = { img: string; diffs: { x: number; y: number; r: number }[] }
type Scene = { id: string; label: string; w: number; h: number; variants: Variant[] }
const BANK = SCENES as Scene[]
const SCENE_TIME = 120
const TAP_SLACK = 1.35 // radii are generous already

export default function SpotItPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [sceneIdx, setSceneIdx] = useState(0)
  const [variant, setVariant] = useState<Variant | null>(null)
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

  const scene = BANK[sceneIdx % BANK.length]

  useEffect(() => { if (profile && balance === null) setBalance(profile.fp_balance) }, [profile, balance])
  useEffect(() => {
    const s = parseInt(localStorage.getItem('spotit_scene') || '0', 10)
    const idx = isNaN(s) ? 0 : s % BANK.length
    setSceneIdx(idx)
    setVariant(pickVariant(BANK[idx]))
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

  // rotate through copies without repeating the recent ones
  function pickVariant(sc: Scene): Variant {
    let recent: string[] = []
    try { recent = JSON.parse(localStorage.getItem(`spotit_recent_${sc.id}`) || '[]') } catch {}
    const fresh = sc.variants.filter(v => !recent.includes(v.img))
    const pool = fresh.length ? fresh : sc.variants
    const pick = pool[Math.floor(Math.random() * pool.length)]
    try {
      localStorage.setItem(`spotit_recent_${sc.id}`, JSON.stringify([pick.img, ...recent].slice(0, 12)))
    } catch {}
    return pick
  }

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
    setVariant(pickVariant(BANK[idx % BANK.length]))
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
    if (phase !== 'playing' || hintsLeft <= 0 || hintMark || !variant) return
    const unfound = variant.diffs.map((_, k) => k).filter(k => !found.includes(k))
    if (!unfound.length) return
    const k = unfound[Math.floor(Math.random() * unfound.length)]
    setHintsLeft(h => h - 1)
    setHintMark({ k, key: Date.now() })
    sfx.swap()
    setTimeout(() => setHintMark(null), 2200)
  }

  function tap(img: 'a' | 'b', e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'playing' || !variant) return
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    for (let k = 0; k < variant.diffs.length; k++) {
      if (found.includes(k)) continue
      const d = variant.diffs[k]
      const dx = (nx - d.x) * scene.w, dy = (ny - d.y) * scene.h
      if (Math.hypot(dx, dy) <= d.r * scene.w * TAP_SLACK) {
        const nf = [...found, k]
        setFound(nf); sfx.match(1)
        reward('find')
        if (nf.length === variant.diffs.length) {
          setPhase('won'); sfx.levelUp(); reward('scene'); refetch()
        }
        return
      }
    }
    penaltyRef.current += 5
    setWrongMark({ x: nx, y: ny, img, key: Date.now() })
    sfx.invalid()
    setTimeout(() => setWrongMark(null), 700)
  }

  const overlays = (which: 'a' | 'b') => variant && (
    <>
      {found.map(k => {
        const d = variant.diffs[k]
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
      {hintMark && !found.includes(hintMark.k) && (() => {
        const d = variant.diffs[hintMark.k]
        const rr = d.r * 1.4
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
        <h1 className="font-black tracking-[0.12em] text-lg" style={{ color: '#7dd3fc', textShadow: '0 0 12px #0ea5e9, 0 2px 0 #000' }}>PIC HUNT</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()}</span>
      </div>

      <div className="max-w-md mx-auto px-4 flex items-center justify-between text-[13px] font-black">
        <span style={{ color: '#7dd3fc' }}>🔍 {scene.label.toUpperCase()}</span>
        <span className={timeLeft <= 20 ? 'text-red-400' : 'text-white/80'}
          style={{ animation: phase === 'playing' && timeLeft <= 20 ? 'meterPulse 0.9s ease-in-out infinite' : undefined }}>
          ⏱ {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
        </span>
        <span className="text-green-300">{found.length}/{variant?.diffs.length ?? 6} FOUND</span>
      </div>

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

      <div className="max-w-md mx-auto px-2 mt-2 space-y-1.5 relative">
        <div className="relative rounded-lg overflow-hidden select-none" style={{ border: '2px solid rgba(255,255,255,0.15)', touchAction: 'manipulation' }}
          onPointerDown={e => tap('a', e)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/spotit2/${scene.id}.jpg`} alt="" draggable={false} className="w-full block" />
          {overlays('a')}
        </div>
        <div className="relative rounded-lg overflow-hidden select-none" style={{ border: '2px solid rgba(255,255,255,0.15)', touchAction: 'manipulation' }}
          onPointerDown={e => tap('b', e)}>
          {variant && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/spotit2/${variant.img}`} alt="" draggable={false} className="w-full block" />
          )}
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
                <h2 className="text-3xl font-black" style={{ color: '#7dd3fc', textShadow: '0 0 16px #0ea5e9' }}>PIC HUNT</h2>
                <p className="text-white/70 text-sm mt-2">Two pictures, 6 differences — a different set every round. Tap them on either picture; wrong taps cost 5 seconds.</p>
                <p className="text-white/50 text-xs mt-1.5">25 FP per find · 250 FP for a clean sweep</p>
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
                <p className="text-white/70 text-sm mt-2">{found.length}/{variant?.diffs.length ?? 6} found · +{fpGame} FP kept</p>
                <button onClick={start} className="w-full mt-4 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#f87171,#b91c1c)' }}>↻ TRY AGAIN (new differences)</button>
                <button onClick={nextScene} className="w-full mt-2 py-2.5 rounded-xl font-bold text-sm bg-white/10">Skip to next scene</button>
              </>}
            </div>
          </div>
        )}
      </div>

      <p className="text-center text-white/40 text-[11px] mt-3">{BANK.length} scene{BANK.length===1?'':'s'} · 20 hand-made versions each — no two rounds alike. More scenes landing soon.</p>

      <style>{`
        @keyframes foundPop { 0% { transform: scale(0.3); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
        @keyframes hintRing { 0% { transform: scale(1.6); opacity: 0 } 15% { opacity: 1 } 80% { transform: scale(1); opacity: 1 } 100% { opacity: 0 } }
        @keyframes wrongFade { 0% { opacity: 1 } 100% { opacity: 0; transform: translate(-50%,-90%) } }
        @keyframes meterPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.1) } }
      `}</style>
    </div>
  )
}

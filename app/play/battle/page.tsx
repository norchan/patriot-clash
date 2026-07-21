'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import GuestAdGate from '@/components/GuestAdGate'
import { republicanEnemies, democratEnemies, type Enemy } from '@/config/enemies'

// GUEST SPRITE BATTLE — a real fight, no account: tap attacks, the sprite
// hits back on a timer. Win or lose, the exit ramp is sign-up (guests can't
// capture or keep FP). Full-page ad gates the first fight of the session.

const ALL = [...republicanEnemies, ...democratEnemies]
const PLAYER_MOVES = [
  { name: 'Jab', emoji: '🤛', min: 8, max: 14, cd: 900 },
  { name: 'Cross', emoji: '🤜', min: 12, max: 20, cd: 1500 },
  { name: 'Haymaker', emoji: '💥', min: 16, max: 30, cd: 2600 },
]

function GuestBattle() {
  const router = useRouter()
  const params = useSearchParams()
  const [enemy, setEnemy] = useState<Enemy | null>(null)
  const [eHp, setEHp] = useState(1)
  const [pHp, setPHp] = useState(100)
  const [eMax, setEMax] = useState(1)
  const [phase, setPhase] = useState<'fight' | 'won' | 'lost'>('fight')
  const [shake, setShake] = useState(0)
  const [flash, setFlash] = useState(0)
  const [floaters, setFloaters] = useState<{ id: number; txt: string; mine: boolean }[]>([])
  const [cooling, setCooling] = useState<Record<string, boolean>>({})
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const fid = useRef(0)

  useEffect(() => {
    const e = ALL.find(x => x.id === params.get('e')) ?? ALL[Math.floor(Math.random() * ALL.length)]
    setEnemy(e)
    const max = Math.round(e.hp * 1.1)
    setEMax(max); setEHp(max); setPHp(100); setPhase('fight')
  }, [params])

  // enemy counterattacks
  useEffect(() => {
    if (!enemy || phase !== 'fight') return
    const iv = setInterval(() => {
      if (phaseRef.current !== 'fight') return
      const dmg = Math.round(enemy.power / 7 + Math.random() * (enemy.power / 6))
      setPHp(h => {
        const next = Math.max(0, h - dmg)
        if (next === 0) setPhase('lost')
        return next
      })
      setFlash(f => f + 1)
      float(`-${dmg}`, false)
    }, 2100)
    return () => clearInterval(iv)
  }, [enemy, phase])

  function float(txt: string, mine: boolean) {
    const id = ++fid.current
    setFloaters(f => [...f.slice(-4), { id, txt, mine }])
    setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 900)
  }

  function attack(mv: typeof PLAYER_MOVES[number]) {
    if (phase !== 'fight' || cooling[mv.name] || !enemy) return
    setCooling(c => ({ ...c, [mv.name]: true }))
    setTimeout(() => setCooling(c => ({ ...c, [mv.name]: false })), mv.cd)
    const dmg = Math.round(mv.min + Math.random() * (mv.max - mv.min))
    setShake(s => s + 1)
    float(`-${dmg}`, true)
    setEHp(h => {
      const next = Math.max(0, h - dmg)
      if (next === 0) setPhase('won')
      return next
    })
  }

  if (!enemy) return null
  const another = () => {
    const e = ALL[Math.floor(Math.random() * ALL.length)]
    router.replace(`/play/battle?e=${e.id}`)
  }

  return (
    <div className="relative h-screen overflow-hidden max-w-md mx-auto bg-gray-950 flex flex-col">
      <GuestAdGate gateKey="battle" />

      {/* top bar */}
      <div className="px-4 pt-4 flex items-center justify-between">
        <button onClick={() => router.push('/play')} className="text-gray-400 text-sm font-bold hover:text-white">← Map</button>
        <span className="text-gray-500 text-xs font-black">👻 GUEST FIGHT</span>
      </div>

      {/* enemy */}
      <div className="px-5 mt-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-black text-white">{enemy.name}</span>
          <span className="text-gray-500 text-xs font-bold">{enemy.party === 'democrat' ? '🔵' : '🔴'} {enemy.tier}</span>
        </div>
        <div className="mt-1 h-3 rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${(eHp / eMax) * 100}%`, background: 'linear-gradient(90deg,#ef4444,#f97316)' }} />
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        <div key={shake} className="animate-[wiggle_0.3s_ease]" style={{ animation: shake ? 'wiggle 0.3s ease' : undefined }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enemy.image} alt={enemy.name}
            className="w-56 h-56 object-contain drop-shadow-[0_0_25px_rgba(139,92,246,0.45)]"
            style={{ animation: 'bob 2.4s ease-in-out infinite' }} />
        </div>
        {floaters.map(f => (
          <span key={f.id}
            className={`absolute font-black text-2xl pointer-events-none ${f.mine ? 'text-yellow-300' : 'text-red-400'}`}
            style={{
              left: f.mine ? '58%' : '30%', top: f.mine ? '30%' : '62%',
              animation: 'floatUp 0.9s ease-out forwards',
            }}>
            {f.txt}
          </span>
        ))}
        {flash > 0 && phase === 'fight' && (
          <div key={`fl${flash}`} className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(circle, transparent 55%, rgba(239,68,68,0.25))', animation: 'fadeOut 0.4s forwards' }} />
        )}
      </div>

      {/* player HP + moves */}
      <div className="px-5 pb-7">
        <div className="flex items-center justify-between text-sm">
          <span className="font-black text-white">You</span>
          <span className="text-gray-400 text-xs font-bold tabular-nums">{pHp}/100</span>
        </div>
        <div className="mt-1 h-3 rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pHp}%`, background: 'linear-gradient(90deg,#22c55e,#84cc16)' }} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {PLAYER_MOVES.map(mv => (
            <button key={mv.name} onClick={() => attack(mv)} disabled={phase !== 'fight' || cooling[mv.name]}
              className="py-3.5 rounded-2xl font-black text-white text-sm transition active:scale-90 disabled:opacity-35 border border-purple-800"
              style={{ background: 'linear-gradient(160deg, #312e81, #1e1b4b)' }}>
              <span className="block text-xl">{mv.emoji}</span>
              {mv.name}
            </button>
          ))}
        </div>
      </div>

      {/* end overlays */}
      {phase !== 'fight' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6"
          style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-3xl p-6 text-center"
            style={{ background: 'linear-gradient(160deg, #17102b, #0b0716)', border: '1px solid rgba(139,92,246,0.45)' }}>
            <div className="text-5xl">{phase === 'won' ? '🏆' : '💀'}</div>
            <h2 className="mt-2 text-white font-black text-2xl">
              {phase === 'won' ? `You beat ${enemy.name}!` : `${enemy.name} got you`}
            </h2>
            <p className="mt-2 text-gray-400 text-sm">
              {phase === 'won'
                ? <>Players would earn <b className="text-yellow-400">{enemy.fpReward} FP</b> and a capture chance for this. Sign up free to keep your winnings.</>
                : 'Real players level up, gear up, and hit harder. Sign up free and come back swinging.'}
            </p>
            <button onClick={() => router.push('/sign-up')}
              className="w-full mt-4 py-3 rounded-xl font-black text-white"
              style={{ background: 'linear-gradient(90deg, #2563eb, #7c3aed, #dc2626)' }}>
              ⚔️ Sign up — free
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={another} className="py-2.5 rounded-xl text-sm font-bold text-gray-300 bg-white/5 hover:bg-white/10">
                Fight another
              </button>
              <button onClick={() => router.push('/play')} className="py-2.5 rounded-xl text-sm font-bold text-gray-300 bg-white/5 hover:bg-white/10">
                Back to map
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-12px) } }
        @keyframes wiggle { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-9px) } 75% { transform: translateX(9px) } }
        @keyframes floatUp { from { opacity: 1; transform: translateY(0) } to { opacity: 0; transform: translateY(-46px) } }
        @keyframes fadeOut { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </div>
  )
}

export default function GuestBattlePage() {
  return (
    <Suspense fallback={<div className="h-screen bg-gray-950" />}>
      <GuestBattle />
    </Suspense>
  )
}

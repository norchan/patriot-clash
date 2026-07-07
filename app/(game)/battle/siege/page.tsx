'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { useLocation } from '@/hooks/useLocation'
import FighterRig, { type FighterPose } from '@/components/FighterRig'
import TownHall from '@/components/TownHall'
import { defaultFighter, sanitizeFighter, type FighterDesign } from '@/lib/fighter'

// Siege Mode: attacking a town hall is a battle scene, not a button. The
// server's challenge API stays fully authoritative — this screen calls it
// once per assault and choreographs the damage it returns.

interface SiegeGym {
  id: string
  city_name: string
  state: string
  holder_id: string | null
  holder_party: 'democrat' | 'republican' | null
  holder_username: string | null
  defense_points: number
  radius_miles: number
}

const ATTACK_POSES: FighterPose[] = ['cross', 'hook', 'kick', 'hook', 'uppercut']

function SiegePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const gymId = searchParams.get('gym')
  const { profile, refetch } = useProfile()
  const { location } = useLocation()

  const [gym, setGym] = useState<SiegeGym | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'assault' | 'result'>('loading')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)

  // Scene state
  const [myPose, setMyPose] = useState<FighterPose>('idle')
  const [attacking, setAttacking] = useState(false)
  const [guardPose, setGuardPose] = useState<FighterPose>('idle')
  const [guardVisible, setGuardVisible] = useState(false)
  const [defense, setDefense] = useState(0)
  const [maxDefense, setMaxDefense] = useState(1)
  const [shaking, setShaking] = useState(false)
  const [flagParty, setFlagParty] = useState<'democrat' | 'republican' | null>(null)
  const [banner, setBanner] = useState('')
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number; text: string; color: string }[]>([])
  const [confetti, setConfetti] = useState<{ id: number; x: number; dx: number; dy: number; color: string; size: number }[]>([])
  const [result, setResult] = useState<{ captured: boolean; damage: number; remaining: number } | null>(null)
  const idRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    if (!gymId) return
    fetch(`/api/gyms/${gymId}`)
      .then(r => r.json())
      .then(d => {
        if (d.gym) {
          setGym(d.gym)
          setDefense(d.gym.defense_points)
          setMaxDefense(Math.max(d.gym.defense_points, 1))
          setFlagParty(d.gym.holder_party)
          setPhase('ready')
        }
      })
      .catch(() => {})
  }, [gymId])

  const myFighter: FighterDesign = sanitizeFighter(profile?.fighter, profile?.id ?? 'me')
  const guardFighter: FighterDesign = defaultFighter(`${gymId}guard`)
  const myColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const holderColor = gym?.holder_party === 'democrat' ? '#2563eb' : gym?.holder_party === 'republican' ? '#dc2626' : '#9ca3af'
  const samePartyHall = !!gym?.holder_party && gym.holder_party === profile?.party

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  function addSpark(text: string, color: string) {
    const id = ++idRef.current
    setSparks(s => [...s, { id, x: 62 + Math.random() * 14, y: 30 + Math.random() * 22, text, color }])
    setTimeout(() => setSparks(s => s.filter(sp => sp.id !== id)), 800)
  }

  function throwConfetti() {
    const burst: typeof confetti = []
    const colors = [myColor, '#facc15', '#ffffff', myColor]
    for (let i = 0; i < 26; i++) {
      burst.push({
        id: ++idRef.current,
        x: 20 + Math.random() * 60,
        dx: (Math.random() - 0.5) * 120,
        dy: 40 + Math.random() * 130,
        color: colors[i % colors.length],
        size: 4 + Math.random() * 5,
      })
    }
    setConfetti(burst)
    setTimeout(() => setConfetti([]), 1600)
  }

  async function launchAssault() {
    if (!gym || !location || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/gyms/${gym.id}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: location.lat, longitude: location.lng, fp_spent: 100 }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        showToast(`❌ ${data.message || data.error || 'Attack failed'}`)
        setBusy(false)
        return
      }
      refetch()
      choreograph(data.captured, data.damage ?? 0, data.defense_remaining ?? 0)
    } catch {
      showToast('❌ Attack failed')
      setBusy(false)
    }
  }

  function choreograph(captured: boolean, damage: number, remaining: number) {
    setPhase('assault')
    setResult({ captured, damage, remaining })
    const timers = timersRef.current
    const schedule = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

    const startDefense = defense
    // Split the server's damage into 5 blows (capture drains to zero)
    const totalDrop = captured ? startDefense : damage
    const blows = 5
    let t = 400

    setBanner('ASSAULT!')
    schedule(700, () => setBanner(''))

    for (let i = 0; i < blows; i++) {
      const pose = ATTACK_POSES[i % ATTACK_POSES.length]
      const after = Math.max(0, Math.round(startDefense - (totalDrop * (i + 1)) / blows))
      schedule(t, () => {
        setMyPose(pose)
        setAttacking(true)
      })
      schedule(t + 160, () => {
        setShaking(true)
        addSpark(`-${Math.max(1, Math.round(totalDrop / blows))}`, '#facc15')
        setDefense(after)
        setTimeout(() => setShaking(false), 190)
      })
      schedule(t + 380, () => { setMyPose('idle'); setAttacking(false) })

      // Garrison defender runs out after the second blow for one exchange
      if (i === 1 && gym?.holder_id) {
        t += 700
        schedule(t, () => { setGuardVisible(true); setGuardPose('idle') })
        schedule(t + 500, () => setGuardPose('jab'))
        schedule(t + 650, () => setMyPose('hit'))
        schedule(t + 950, () => { setMyPose('hook'); setAttacking(true) })
        schedule(t + 1100, () => setGuardPose('hit'))
        schedule(t + 1400, () => { setGuardPose('ko'); setMyPose('idle'); setAttacking(false) })
        schedule(t + 2100, () => setGuardVisible(false))
        t += 1600
      }
      t += 850
    }

    // Finale
    schedule(t + 200, () => {
      if (captured) {
        setBanner('CAPTURED!')
        setFlagParty(profile?.party ?? null)
        setMyPose('victory')
        throwConfetti()
      } else {
        setBanner('DEFENSE HOLDS')
        setMyPose('idle')
      }
    })
    schedule(t + 1900, () => {
      setBanner('')
      setPhase('result')
      setBusy(false)
    })
  }

  function skip() {
    if (phase !== 'assault' || !result) return
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setGuardVisible(false)
    setAttacking(false)
    setShaking(false)
    setDefense(result.captured ? 0 : result.remaining)
    if (result.captured) { setFlagParty(profile?.party ?? null); setMyPose('victory'); throwConfetti() }
    else setMyPose('idle')
    setBanner('')
    setPhase('result')
    setBusy(false)
  }

  if (phase === 'loading' || !profile) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center"><div className="text-4xl mb-3">🏛️</div><p className="text-gray-400">Scouting the target...</p></div>
      </div>
    )
  }

  if (!gym) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
        <p className="text-gray-400">Town hall not found.</p>
        <button onClick={() => router.push('/map')} className="mt-4 text-blue-400">← Back to Map</button>
      </div>
    )
  }

  const damagePct = 1 - defense / maxDefense

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      {/* ══ SIEGE STAGE ═══════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden select-none" onClick={skip}
        style={{
          height: '58vh',
          background: 'linear-gradient(180deg, #101529 0%, #23203d 40%, #3d3548 55%, #2b2b31 64%, #202024 100%)',
        }}>

        {/* dusk glow behind the hall */}
        <div className="absolute pointer-events-none" style={{ right: '2%', top: '8%', width: '55%', height: '60%', background: `radial-gradient(ellipse, ${holderColor}22 0%, transparent 65%)`, filter: 'blur(8px)' }} />

        {/* street */}
        <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ height: '20%', background: 'linear-gradient(180deg, #34343b 0%, #232327 100%)' }} />

        {/* HUD: hall defense bar */}
        <div className="absolute top-3 left-3 right-3 z-20">
          <div className="flex items-center justify-between mb-1">
            <span className="text-white text-xs font-black">🏛️ {gym.city_name} Town Hall</span>
            <span className="text-gray-300 text-xs font-bold tabular-nums">{defense.toLocaleString()} DEF</span>
          </div>
          <div className="h-3.5 bg-black/60 rounded-sm overflow-hidden border border-white/20">
            <div className="h-full transition-all duration-300"
              style={{ width: `${(defense / maxDefense) * 100}%`, background: `linear-gradient(90deg, ${holderColor}, ${holderColor}bb)` }} />
          </div>
          {gym.holder_username && (
            <p className="text-gray-400 text-[10px] mt-1">Held by {gym.holder_username}{gym.holder_party ? ` · ${gym.holder_party === 'democrat' ? 'Democrat' : 'Republican'}` : ''}</p>
          )}
        </div>

        {/* banner */}
        {banner && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <span className="font-black" style={{
              fontSize: 46, letterSpacing: 2,
              color: banner === 'CAPTURED!' ? '#4ade80' : banner === 'DEFENSE HOLDS' ? '#f87171' : '#facc15',
              textShadow: '0 0 24px rgba(250,204,21,0.5), 0 4px 8px #000',
              animation: 'sgBanner 0.5s ease-out',
            }}>{banner}</span>
          </div>
        )}

        {/* sparks */}
        {sparks.map(s => (
          <div key={s.id} className="absolute z-20 pointer-events-none" style={{ left: `${s.x}%`, top: `${s.y}%`, animation: 'sgSpark 0.8s ease-out forwards' }}>
            <span className="font-black text-xl" style={{ color: s.color, textShadow: `0 0 10px ${s.color}, 0 2px 4px #000` }}>{s.text}</span>
          </div>
        ))}

        {/* confetti */}
        {confetti.map(c => (
          <div key={c.id} className="absolute z-30 pointer-events-none" style={{
            left: `${c.x}%`, top: '20%', width: c.size, height: c.size * 1.6,
            background: c.color,
            ['--dx' as any]: `${c.dx}px`, ['--dy' as any]: `${c.dy}px`,
            animation: 'sgConfetti 1.5s ease-in forwards',
          }} />
        ))}

        {/* town hall (right) */}
        <div className="absolute z-10" style={{ right: '2%', bottom: '9%' }}>
          <TownHall flagParty={flagParty} damagePct={damagePct} shaking={shaking} height={Math.min(250, 230)} />
        </div>

        {/* garrison defender */}
        {guardVisible && (
          <div className="absolute z-10 transition-all duration-500" style={{ left: '42%', bottom: '8%' }}>
            <FighterRig design={guardFighter} pose={guardPose} facing="left" height={200} />
          </div>
        )}

        {/* my fighter (left) */}
        <div className="absolute z-10" style={{ left: '6%', bottom: '8%', filter: `drop-shadow(0 0 10px ${myColor}33)` }}>
          <FighterRig design={myFighter} pose={myPose} facing="right" height={230} attacking={attacking} />
          <div className="w-24 h-3 mx-auto -mt-1 rounded-full" style={{ background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)' }} />
        </div>

        {phase === 'assault' && (
          <div className="absolute bottom-2 right-3 z-20 pointer-events-none">
            <span className="text-white/35 text-[10px] font-bold tracking-widest">TAP TO SKIP ⏭</span>
          </div>
        )}
      </div>

      {/* ══ CONTROLS ══════════════════════════════════════════════════════ */}
      <div className="flex-1 px-4 py-4 overflow-y-auto">
        <div className="max-w-md mx-auto space-y-3">
          {phase === 'ready' && (
            <>
              {samePartyHall ? (
                <div className="text-center">
                  <p className="text-gray-300 text-sm mb-3">Your party holds this hall — donate to defend it instead!</p>
                  <button onClick={() => router.push(`/townhall/${gym.id}`)}
                    className="w-full py-3 rounded-xl font-bold text-white transition"
                    style={{ background: myColor }}>
                    🏛️ Go Donate
                  </button>
                </div>
              ) : (
                <button onClick={launchAssault} disabled={busy || (profile.fp_balance ?? 0) < 100 || !location}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-black text-lg transition active:scale-95">
                  {busy ? '⏳ ...' : '⚔️ LAUNCH ASSAULT (100 FP)'}
                </button>
              )}
              <button onClick={() => router.back()}
                className="w-full py-3 bg-gray-900 border border-gray-800 text-gray-400 rounded-xl font-bold text-sm hover:bg-gray-800 transition">
                ← Retreat
              </button>
            </>
          )}

          {phase === 'assault' && (
            <p className="text-gray-600 text-xs text-center">⚔️ Assault in progress...</p>
          )}

          {phase === 'result' && result && (
            <>
              <div className="text-center">
                <div className="text-5xl mb-1">{result.captured ? '🏛️' : '🛡️'}</div>
                <h2 className="font-black text-2xl" style={{ color: result.captured ? '#4ade80' : '#f87171' }}>
                  {result.captured ? 'HALL CAPTURED!' : 'DEFENSE HOLDS'}
                </h2>
                <p className="text-gray-400 text-sm mt-1">
                  {result.captured
                    ? `${gym.city_name} flies your colors now! +50 FP bonus`
                    : `You dealt ${result.damage.toLocaleString()} damage — ${result.remaining.toLocaleString()} defense remains`}
                </p>
              </div>
              {!result.captured && (
                <button onClick={() => { setPhase('ready') }}
                  disabled={(profile.fp_balance ?? 0) < 100}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-black transition active:scale-95">
                  ⚔️ ATTACK AGAIN (100 FP)
                </button>
              )}
              <button onClick={() => router.push('/map')}
                className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold transition">
                Back to Map
              </button>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
        </div>
      )}

      <style>{`
        @keyframes sgBanner { 0%{transform:scale(2.2);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes sgSpark { 0%{transform:translateY(0) scale(0.7);opacity:1} 100%{transform:translateY(-44px) scale(1.15);opacity:0} }
        @keyframes sgConfetti { 0%{transform:translate(0,0) rotate(0deg);opacity:1} 100%{transform:translate(var(--dx),var(--dy)) rotate(540deg);opacity:0} }
      `}</style>
    </div>
  )
}

export default function SiegeModePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Loading siege...</span>
      </div>
    }>
      <SiegePage />
    </Suspense>
  )
}

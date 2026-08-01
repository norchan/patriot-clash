'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { GRID, HQ_PAD, PRINT_SHOP_PAD, buildingDef, hqImage, safeImage } from '@/config/house'

// ⚔️ RAID SCREEN (Phase 2). Find a base → see the pot → smash it.
//
// The SERVER resolves the whole raid the moment you tap RAID — damage, loot
// and trophies are settled before the first building falls. Everything after
// that is theater: each tap smashes a building and "finds" a share of loot
// that was already yours. Same trick as the siege screen; the fun is real,
// the numbers are not negotiable.

interface TargetBase { baseLevel: number; padsOpen: number; buildings: Array<{ pad: number; type: string; level: number }> }
interface Target { id: string; username: string; party: string; level: number; base_level: number; base: TargetBase }
interface Found { target: Target; cost: number; loot_min: number; loot_max: number }
interface Result { damage_pct: number; loot: number; trophies: number; base: TargetBase; defender: { username: string; party: string } }

type PhaseT = 'finding' | 'preview' | 'smash' | 'done'

function pop(freq = 220) {
  try {
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)()
    const o = ac.createOscillator(); const g = ac.createGain()
    o.type = 'square'; o.frequency.value = freq
    g.gain.setValueAtTime(0.08, ac.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18)
    o.connect(g); g.connect(ac.destination)
    o.start(); o.stop(ac.currentTime + 0.2)
  } catch {}
}
const buzz = (ms: number) => { try { navigator.vibrate?.(ms) } catch {} }

export default function RaidPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [phase, setPhase] = useState<PhaseT>('finding')
  const [found, setFound] = useState<Found | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [smashed, setSmashed] = useState<Set<number>>(new Set())
  const [lootShown, setLootShown] = useState(0)
  const [floats, setFloats] = useState<Array<{ id: number; pad: number; text: string }>>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const floatId = useRef(0)

  const isRep = (p?: string) => p === 'republican'

  async function findTarget() {
    setPhase('finding'); setErr(''); setResult(null); setSmashed(new Set()); setLootShown(0)
    try {
      const res = await fetch('/api/house/raid')
      const d = await res.json()
      if (!res.ok) { setErr(d.message ?? d.error ?? 'No targets found'); return }
      setFound(d); setPhase('preview')
    } catch { setErr('Network error') }
  }
  useEffect(() => { findTarget() }, [])

  async function launch() {
    if (busy || !found) return
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/house/raid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defender_id: found.target.id }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.message ?? d.error ?? 'Raid failed'); return }
      setResult(d); setPhase('smash'); buzz(40)
      refetch()
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  // theater bookkeeping: loot splits across the smashable buildings
  const smashable = result?.base.buildings ?? []
  const perBuilding = smashable.length ? Math.floor((result?.loot ?? 0) / smashable.length) : 0

  function smash(pad: number) {
    if (!result || smashed.has(pad)) return
    const next = new Set(smashed); next.add(pad)
    setSmashed(next)
    const isLast = next.size >= smashable.length
    const chunk = isLast ? (result.loot - perBuilding * (smashable.length - 1)) : perBuilding
    setLootShown(v => v + chunk)
    const id = ++floatId.current
    setFloats(f => [...f, { id, pad, text: chunk > 0 ? `+${chunk} FP` : '💥' }])
    setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 900)
    pop(160 + Math.random() * 120); buzz(25)
    if (isLast) setTimeout(() => setPhase('done'), 700)
  }

  function yardCell(pad: number, base: TargetBase, interactive: boolean) {
    const cls = 'aspect-square rounded-lg flex flex-col items-center justify-center transition relative'
    if (pad === HQ_PAD) return (
      <div key={pad} className={`${cls} border-2 border-gray-600 bg-gray-800/60 overflow-visible`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hqImage(base.baseLevel)} alt=""
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[150%] max-w-none z-10 pointer-events-none" />
      </div>
    )
    if (pad === PRINT_SHOP_PAD) return (
      <div key={pad} className={`${cls} border border-gray-700 bg-gray-900`}><span className="text-lg">🖨️</span></div>
    )
    const b = base.buildings.find(x => x.pad === pad)
    if (!b) return <div key={pad} className={`${cls} border border-gray-900 bg-gray-950/50`}><span className="opacity-25 text-xs">🌱</span></div>
    const emoji = b.type === 'decor' ? '🚩' : (buildingDef(b.type)?.emoji ?? '🏗️')
    const dead = smashed.has(pad)
    if (b.type === 'safe') {
      return (
        <button key={pad} disabled={!interactive || dead} onClick={() => smash(pad)}
          className={`${cls} border ${dead ? 'border-orange-900 bg-orange-950/40' : interactive ? 'border-yellow-600 bg-gray-900 animate-pulse' : 'border-gray-700 bg-gray-900'} ${interactive && !dead ? 'active:scale-90' : ''} overflow-visible`}>
          {dead ? <span className="text-lg">💥</span> : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={safeImage(b.level)} alt="" className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[115%] max-w-none pointer-events-none" />
          )}
          {floats.filter(f => f.pad === pad).map(f => (
            <span key={f.id} className="absolute -top-2 text-yellow-300 font-black text-xs animate-bounce z-10">{f.text}</span>
          ))}
        </button>
      )
    }
    return (
      <button key={pad} disabled={!interactive || dead} onClick={() => smash(pad)}
        className={`${cls} border ${dead ? 'border-orange-900 bg-orange-950/40' : interactive ? 'border-yellow-600 bg-gray-900 animate-pulse' : 'border-gray-700 bg-gray-900'} ${interactive && !dead ? 'active:scale-90' : ''}`}>
        <span className={`text-lg ${dead ? 'grayscale opacity-40' : ''}`}>{dead ? '💥' : emoji}</span>
        {!dead && b.type !== 'decor' && <span className="text-[8px] text-gray-500 font-bold">L{b.level}</span>}
        {floats.filter(f => f.pad === pad).map(f => (
          <span key={f.id} className="absolute -top-2 text-yellow-300 font-black text-xs animate-bounce">{f.text}</span>
        ))}
      </button>
    )
  }

  const yard = (base: TargetBase, interactive: boolean) => (
    <div className="rounded-2xl border border-gray-800 p-3"
      style={{ background: 'radial-gradient(circle at 30% 20%, #231a14, #120d0b 70%)' }}>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }}>
        {Array.from({ length: GRID * GRID }, (_, i) => yardCell(i, base, interactive))}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-28">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/hq')} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="text-white font-black text-lg">⚔️ Raid</h1>
          <span className="ml-auto text-yellow-400 font-black text-sm">⚡ {profile?.fp_balance?.toLocaleString() ?? 0}</span>
        </div>

        {err && <div className="mt-4 bg-red-950/60 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm text-center">{err}</div>}

        {phase === 'finding' && !err && (
          <p className="mt-10 text-center text-gray-500 font-bold animate-pulse">Scouting for a base…</p>
        )}

        {phase === 'preview' && found && (
          <>
            <div className="mt-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-white"
                style={{ background: isRep(found.target.party) ? '#dc2626' : '#2563eb' }}>
                {found.target.username[0]?.toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-white font-black">{found.target.username}</p>
                <p className="text-gray-500 text-xs">Lv {found.target.level} · Base {found.target.base_level} ⭐</p>
              </div>
              <button onClick={findTarget} className="text-gray-400 hover:text-white p-2" title="Next target"><RefreshCw size={17} /></button>
            </div>
            <div className="mt-3">{yard(found.target.base, false)}</div>
            <div className="mt-3 bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex items-center justify-between">
              <span className="text-gray-400 text-sm font-bold">Potential loot</span>
              <span className="text-yellow-300 font-black">⚡ {found.loot_min}–{found.loot_max}</span>
            </div>
            <button onClick={launch} disabled={busy}
              className="mt-3 w-full py-4 rounded-2xl font-black text-white text-lg active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
              {busy ? '…' : `⚔️ RAID — ${found.cost} FP`}
            </button>
          </>
        )}

        {(phase === 'smash' || phase === 'done') && result && (
          <>
            <p className="mt-4 text-center text-gray-400 text-sm font-bold">
              {phase === 'smash' ? `Tap ${result.defender.username}'s buildings to loot them!` : 'Raid complete'}
            </p>
            <div className="mt-3">{yard(result.base, phase === 'smash')}</div>
            <div className="mt-3 flex items-center justify-center gap-6">
              <span className="text-yellow-300 font-black text-xl">⚡ +{lootShown}</span>
              <span className="text-gray-400 font-bold text-sm">{result.damage_pct}% damage</span>
              <span className="text-amber-400 font-black text-sm">🏆 +{result.trophies}</span>
            </div>
            {phase === 'smash' && (
              <button onClick={() => { setSmashed(new Set(smashable.map(b => b.pad))); setLootShown(result.loot); setPhase('done') }}
                className="mt-3 w-full py-2 text-gray-500 text-xs font-bold">skip →</button>
            )}
            {phase === 'done' && (
              <div className="mt-4 space-y-2">
                <button onClick={findTarget}
                  className="w-full py-4 rounded-2xl font-black text-white text-lg active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
                  ⚔️ RAID AGAIN
                </button>
                <button onClick={() => router.push('/hq')}
                  className="w-full py-3 rounded-2xl font-bold text-gray-300 bg-gray-900 border border-gray-800">
                  🏠 Back to base
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

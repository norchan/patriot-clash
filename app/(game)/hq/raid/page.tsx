'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { GRID, HQ_PAD, PRINT_SHOP_PAD, buildingDef, hqImage, safeImage } from '@/config/house'
import IsoYard, { IsoCellSpec, isoPos, IsoFenceLinks } from '@/components/IsoYard'

// ⚔️ RAID — same isometric stage as the home base (Grok's brief): you scout
// THEIR yard on the full-bleed ground, then smash their buildings sprite by
// sprite. The server settled damage/loot/trophies before the first tap —
// everything after RAID is choreography over decided numbers.

interface TargetBase { baseLevel: number; padsOpen: number; buildings: Array<{ pad: number; type: string; level: number; facing?: number }>; print_shop_pad?: number }
interface Target { id: string; username: string; party: string; level: number; base_level: number; base: TargetBase }
interface Found { target: Target; cost: number; loot_min: number; loot_max: number }
interface Result { damage_pct: number; loot: number; trophies: number; base: TargetBase; defender: { username: string; party: string } }

type PhaseT = 'finding' | 'preview' | 'smash' | 'done'

const SPRITES: Record<string, { img: (level: number) => string; w: number }> = {
  fence: { img: () => '/house/fence.png', w: 118 },
  media_tower: { img: () => '/house/media_tower.png', w: 126 },
  safe: { img: l => safeImage(l), w: 96 },
  decor: { img: () => '/house/decor_flag.png', w: 84 },
  print_shop: { img: () => '/house/print_shop.png', w: 128 },
}

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

  // map the TARGET's yard onto the stage
  const base = result?.base ?? found?.target.base
  const interactive = phase === 'smash'
  const cells: IsoCellSpec[] = []
  const fencePads = new Set((base?.buildings ?? []).filter(b => b.type === 'fence' && !smashed.has(b.pad)).map(b => b.pad))
  const fenceLinked = (pad: number) => {
    const col = pad % GRID, row = Math.floor(pad / GRID)
    return (col > 0 && fencePads.has(pad - 1)) || (col < GRID - 1 && fencePads.has(pad + 1))
      || (row > 0 && fencePads.has(pad - GRID)) || (row < GRID - 1 && fencePads.has(pad + GRID))
  }
  if (base) {
    const onPad = new Map(base.buildings.map(b => [b.pad, b]))
    for (let pad = 0; pad < GRID * GRID; pad++) {
      if (pad === HQ_PAD) { cells.push({ pad, img: hqImage(base.baseLevel), imgW: 198 }); continue }
      if (pad === PRINT_SHOP_PAD) { cells.push({ pad, img: '/house/print_shop.png', imgW: 128 }); continue }
      const b = onPad.get(pad)
      if (!b) { cells.push({ pad, plot: true }); continue }
      const sp = SPRITES[b.type]
      const dead = smashed.has(pad)
      const isFence = b.type === 'fence'
      const linked = isFence && fenceLinked(pad)
      cells.push({
        pad,
        img: dead ? undefined : (isFence ? (linked ? '/house/fence_post.png' : '/house/fence.png') : sp?.img(b.level)),
        imgW: isFence ? (linked ? 13 : 76) : sp?.w,
        mirror: ((b.facing ?? 0) % 2) === 1,
        emoji: dead ? '💥' : (sp ? undefined : buildingDef(b.type)?.emoji ?? '🏗️'),
        dead,
        glow: interactive && !dead,
        onTap: interactive && !dead ? () => smash(pad) : undefined,
        chip: !dead && b.type !== 'decor'
          ? <span className="text-[10px] font-bold px-1 rounded bg-black/45 text-gray-300">Lv {b.level}</span>
          : undefined,
      })
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#150f0d] text-gray-200 select-none">
      {base && (
        <div className="absolute inset-x-0 top-0" style={{ bottom: '4.5rem' }}>
        <IsoYard cells={cells} bg="/house/yard_bg.png">
          <IsoFenceLinks fencePads={fencePads} />
          {floats.map(f => {
            const { x, y } = isoPos(f.pad)
            return (
              <span key={f.id} className="absolute text-yellow-300 font-black text-base animate-bounce pointer-events-none -translate-x-1/2"
                style={{ left: x, top: y - 56, zIndex: 900 }}>{f.text}</span>
            )
          })}
        </IsoYard>
        </div>
      )}

      {/* HUD */}
      <div className="absolute top-3 left-3 z-[70] flex items-center gap-2">
        <button onClick={() => router.push('/hq')} className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center"><ArrowLeft size={17} /></button>
        <span className="px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur text-white font-black text-sm">⚔️ Raid</span>
      </div>
      <div className="absolute top-3 right-3 z-[70]">
        <span className="px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur text-yellow-400 font-black text-sm">⚡ {profile?.fp_balance?.toLocaleString() ?? 0}</span>
      </div>

      {err && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[70] bg-red-950/80 backdrop-blur border border-red-800 rounded-xl px-4 py-2.5 text-red-300 text-sm">{err}</div>
      )}

      {phase === 'finding' && !err && (
        <p className="absolute inset-0 flex items-center justify-center text-gray-400 font-bold animate-pulse z-[65]">Scouting for a base…</p>
      )}

      {phase === 'preview' && found && (
        <div style={{ bottom: '5.5rem' }} className="absolute left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 bg-black/60 backdrop-blur rounded-2xl p-3 pr-4 max-w-[96vw] flex-wrap justify-center">
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-white shrink-0"
            style={{ background: isRep(found.target.party) ? '#dc2626' : '#2563eb' }}>
            {found.target.username[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-white font-black text-sm truncate">{found.target.username}</p>
            <p className="text-gray-400 text-[11px]">Lv {found.target.level} · Base {found.target.base_level}⭐ · loot ⚡{found.loot_min}–{found.loot_max}</p>
          </div>
          <button onClick={findTarget} className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center text-gray-300 shrink-0" title="Next target"><RefreshCw size={15} /></button>
          <button onClick={launch} disabled={busy}
            className="px-5 py-3 rounded-xl font-black text-white shrink-0 active:scale-95 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
            {busy ? '…' : `⚔️ RAID — ${found.cost} FP`}
          </button>
        </div>
      )}

      {(phase === 'smash' || phase === 'done') && result && (
        <>
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-4 bg-black/60 backdrop-blur rounded-2xl px-4 py-2">
            <span className="text-yellow-300 font-black text-lg">⚡ +{lootShown}</span>
            <span className="text-gray-300 font-bold text-xs">{result.damage_pct}% damage</span>
            <span className="text-amber-400 font-black text-xs">🏆 +{result.trophies}</span>
          </div>
          {phase === 'smash' && (
            <div style={{ bottom: '5.5rem' }} className="absolute left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3">
              <span className="px-3 py-2 rounded-xl bg-black/60 backdrop-blur text-gray-300 text-xs font-bold">
                Tap {result.defender.username}'s buildings to loot them!
              </span>
              <button onClick={() => { setSmashed(new Set(smashable.map(b => b.pad))); setLootShown(result.loot); setPhase('done') }}
                className="px-3 py-2 rounded-xl bg-black/40 text-gray-500 text-xs font-bold">skip →</button>
            </div>
          )}
          {phase === 'done' && (
            <div style={{ bottom: '5.5rem' }} className="absolute left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2">
              <button onClick={findTarget}
                className="px-6 py-3.5 rounded-2xl font-black text-white active:scale-95"
                style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
                ⚔️ RAID AGAIN
              </button>
              <button onClick={() => router.push('/hq')}
                className="px-5 py-3.5 rounded-2xl font-bold text-gray-300 bg-black/60 backdrop-blur border border-gray-800">
                🏠 Back to base
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

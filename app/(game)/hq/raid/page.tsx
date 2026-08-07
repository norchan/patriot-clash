'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { GRID, HQ_PAD, PRINT_SHOP_PAD, buildingDef, hqImage, safeImage, barracksImage } from '@/config/house'
import { troopById } from '@/config/troops'
import IsoYard, { IsoCellSpec, isoPos, IsoFenceLinks, fenceAdjacency } from '@/components/IsoYard'

// ⚔️ RAID — same isometric stage as the home base (Grok's brief). The server
// settled damage/loot/trophies before anything moves; what plays out after
// RAID is choreography over decided numbers. Since 2026-08-04 the choreography
// is a TROOP ASSAULT (Michael: "I want the players to use the soldiers they
// build. The player should not be able to just click on a building and destroy
// it") — your trained troops charge in one by one, breach the fence line in
// waves, then wreck the buildings. No tapping.

interface TargetBase { baseLevel: number; padsOpen: number; buildings: Array<{ pad: number; type: string; level: number; facing?: number }>; print_shop_pad?: number }
interface Target { id: string; username: string; party: string; level: number; base_level: number; base: TargetBase }
interface Found { target: Target; cost: number; loot_min: number; loot_max: number; army?: { total: number; power: number; bonus: number } }
interface Result {
  damage_pct: number; loot: number; trophies: number; base: TargetBase
  defender: { username: string; party: string }
  army?: { bonus: number; marched?: Array<{ id: string; n: number }>; losses: Array<{ id: string; n: number; name: string; emoji: string }> }
}

type PhaseT = 'finding' | 'preview' | 'smash' | 'done'

const SPRITES: Record<string, { img: (level: number) => string; w: number }> = {
  fence: { img: () => '/house/fence.png', w: 118 },
  media_tower: { img: () => '/house/media_tower.png', w: 126 },
  safe: { img: l => safeImage(l), w: 96 },
  barracks: { img: l => barracksImage(l), w: 150 },
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
  // the one troop sprite currently charging — CSS transitions move it
  const [attacker, setAttacker] = useState<{ img: string; x: number; y: number; flip: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const floatId = useRef(0)
  const assaultTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const assaultRan = useRef(false)

  const isRep = (p?: string) => p === 'republican'

  function stopAssault() {
    assaultTimers.current.forEach(clearTimeout)
    assaultTimers.current = []
    setAttacker(null)
  }

  async function findTarget() {
    stopAssault(); assaultRan.current = false
    setPhase('finding'); setErr(''); setResult(null); setSmashed(new Set()); setLootShown(0)
    try {
      const res = await fetch('/api/house/raid')
      const d = await res.json()
      if (!res.ok) { setErr(d.message ?? d.error ?? 'No targets found'); return }
      setFound(d); setPhase('preview')
    } catch { setErr('Network error') }
  }
  useEffect(() => { findTarget() }, [])
  useEffect(() => () => stopAssault(), [])

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

  function smashPads(pads: number[], chunk: number) {
    setSmashed(prev => { const next = new Set(prev); pads.forEach(p => next.add(p)); return next })
    setLootShown(v => v + chunk)
    const id = ++floatId.current
    const at = pads[Math.floor(pads.length / 2)]
    setFloats(f => [...f, { id, pad: at, text: chunk > 0 ? `+${chunk} FP` : '💥' }])
    setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 900)
    pop(160 + Math.random() * 120); buzz(25)
  }

  // ── THE ASSAULT — troops charge target by target, fences fall in waves ──
  useEffect(() => {
    if (phase !== 'smash' || !result || assaultRan.current) return
    assaultRan.current = true
    const fences = result.base.buildings.filter(b => b.type === 'fence')
      .sort((a, b) => isoPos(a.pad).depth - isoPos(b.pad).depth).map(b => b.pad)
    const others = result.base.buildings.filter(b => b.type !== 'fence')
      .sort((a, b) => isoPos(a.pad).depth - isoPos(b.pad).depth).map(b => b.pad)
    // breach the fence line first (in up-to-3 waves), then wreck the buildings
    const waves: number[][] = []
    if (fences.length) {
      const W = Math.max(6, Math.ceil(fences.length / 3))
      for (let i = 0; i < fences.length; i += W) waves.push(fences.slice(i, i + W))
    }
    for (const pad of others) waves.push([pad])
    // the roster that marched, expanded (capped so huge armies don't repeat forever)
    const roster = (result.army?.marched ?? []).flatMap(m => Array(Math.min(m.n, 4)).fill(m.id))
    if (!roster.length) roster.push(isRep(profile?.party) ? 'rep_minuteman' : 'dem_picket_captain')
    const chunkBase = waves.length ? Math.floor(result.loot / waves.length) : 0
    const t = (fn: () => void, ms: number) => assaultTimers.current.push(setTimeout(fn, ms))
    const runStep = (i: number) => {
      if (i >= waves.length) {
        setAttacker(null)
        setLootShown(result.loot) // snap over any rounding dust
        t(() => setPhase('done'), 700)
        return
      }
      const pads = waves[i]
      const cx = pads.reduce((s, p) => s + isoPos(p).x, 0) / pads.length
      const cy = pads.reduce((s, p) => s + isoPos(p).y, 0) / pads.length
      const fromLeft = i % 2 === 0
      const img = troopById(roster[i % roster.length])?.img ?? '/troops/rep_minuteman.png'
      // spawn at the yard edge, then charge (the state change triggers the CSS transition)
      setAttacker({ img, x: cx + (fromLeft ? -400 : 400), y: cy + 250, flip: !fromLeft })
      t(() => setAttacker(a => (a ? { ...a, x: cx, y: cy + 10 } : a)), 60)
      t(() => {
        const chunk = i === waves.length - 1 ? result.loot - chunkBase * (waves.length - 1) : chunkBase
        smashPads(pads, chunk)
      }, 660)
      t(() => runStep(i + 1), 1050)
    }
    runStep(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result])

  function skipAssault() {
    if (!result) return
    stopAssault()
    setSmashed(new Set(result.base.buildings.map(b => b.pad)))
    setLootShown(result.loot)
    setPhase('done')
  }

  // map the TARGET's yard onto the stage
  const base = result?.base ?? found?.target.base
  const cells: IsoCellSpec[] = []
  const fencePads = new Set((base?.buildings ?? []).filter(b => b.type === 'fence' && !smashed.has(b.pad)).map(b => b.pad))
  const fenceLinkedSet = fenceAdjacency(fencePads).linked
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
      const linked = isFence && fenceLinkedSet.has(pad)
      cells.push({
        pad,
        img: dead ? undefined : (isFence ? (linked ? '/house/fence_post.png' : '/house/fence.png') : sp?.img(b.level)),
        imgW: isFence ? (linked ? 13 : 76) : sp?.w,
        mirror: ((b.facing ?? 0) % 2) === 1,
        emoji: dead ? '💥' : (sp ? undefined : buildingDef(b.type)?.emoji ?? '🏗️'),
        dead,
        chip: !dead && b.type !== 'decor'
          ? <span className="text-[12px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-gray-200 shadow-lg">Lv {b.level}</span>
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
          {/* the charging troop */}
          {attacker && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attacker.img} alt="" className="absolute max-w-none pointer-events-none"
              style={{
                width: 94,
                left: attacker.x, top: attacker.y,
                transform: `translate(-50%, -100%)${attacker.flip ? ' scaleX(-1)' : ''}`,
                transition: 'left .55s cubic-bezier(.3,.8,.4,1), top .55s cubic-bezier(.3,.8,.4,1)',
                zIndex: 1500,
                filter: 'drop-shadow(0 10px 12px rgba(0,0,0,0.5))',
              }} />
          )}
          {floats.map(f => {
            const { x, y } = isoPos(f.pad)
            return (
              <span key={f.id} className="absolute text-yellow-300 font-black text-base animate-bounce pointer-events-none -translate-x-1/2"
                style={{ left: x, top: y - 56, zIndex: 1600 }}>{f.text}</span>
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

      {phase === 'preview' && found && (() => {
        const noTroops = (found.army?.total ?? 0) === 0
        return (
        <div style={{ bottom: '5.5rem' }} className="absolute left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 bg-black/60 backdrop-blur rounded-2xl p-3 pr-4 max-w-[96vw] flex-wrap justify-center">
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-white shrink-0"
            style={{ background: isRep(found.target.party) ? '#dc2626' : '#2563eb' }}>
            {found.target.username[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-white font-black text-sm truncate">{found.target.username}</p>
            <p className="text-gray-400 text-[11px]">Lv {found.target.level} · Base {found.target.base_level}⭐ · loot ⚡{found.loot_min}–{found.loot_max}</p>
            {noTroops
              ? <p className="text-red-400 text-[11px] font-bold">🎖️ Your troops do the fighting — train some first</p>
              : <p className="text-emerald-400 text-[11px] font-bold">🎖️ Marching {found.army!.total} troops (+{found.army!.bonus} punch) · expect losses</p>}
          </div>
          <button onClick={findTarget} className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center text-gray-300 shrink-0" title="Next target"><RefreshCw size={15} /></button>
          {noTroops ? (
            <button onClick={() => router.push('/hq')}
              className="px-5 py-3 rounded-xl font-black text-white shrink-0 active:scale-95"
              style={{ background: 'linear-gradient(135deg,#059669,#065f46)' }}>
              🎖️ TRAIN TROOPS
            </button>
          ) : (
            <button onClick={launch} disabled={busy}
              className="px-5 py-3 rounded-xl font-black text-white shrink-0 active:scale-95 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
              {busy ? '…' : `⚔️ RAID — ${found.cost} FP`}
            </button>
          )}
        </div>
        )
      })()}

      {(phase === 'smash' || phase === 'done') && result && (
        <>
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-4 bg-black/60 backdrop-blur rounded-2xl px-4 py-2">
            <span className="text-yellow-300 font-black text-lg">⚡ +{lootShown}</span>
            <span className="text-gray-300 font-bold text-xs">{result.damage_pct}% damage</span>
            <span className="text-amber-400 font-black text-xs">🏆 +{result.trophies}</span>
          </div>
          {phase === 'done' && (result.army?.losses?.length ?? 0) > 0 && (
            <div className="absolute top-[6.5rem] left-1/2 -translate-x-1/2 z-[70] bg-black/60 backdrop-blur rounded-xl px-3 py-1.5 text-[11px] font-bold text-red-300 whitespace-nowrap">
              Fallen: {result.army!.losses.map(l => `${l.emoji} ${l.n} ${l.name}`).join(' · ')}
            </div>
          )}
          {phase === 'smash' && (
            <div style={{ bottom: '5.5rem' }} className="absolute left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3">
              <span className="px-3 py-2 rounded-xl bg-black/60 backdrop-blur text-gray-300 text-xs font-bold">
                🎖️ Your troops storm {result.defender.username}'s base!
              </span>
              <button onClick={skipAssault}
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

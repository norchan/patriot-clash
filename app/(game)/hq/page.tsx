'use client'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trophy, Music, VolumeX, Leaf, Share2 } from 'lucide-react'
import { snapshotBase } from '@/lib/base-snapshot'
import { useProfile } from '@/hooks/useProfile'
import {
  GRID, HQ_PAD, PRINT_SHOP_PAD, BUILDINGS,
  buildingDef, buildingCost, TOWER_MAX_LEVEL,
  hqImage, hqUpgradeCost, HQ_MAX_LEVEL,
  safeImage, barracksImage, armyCap, solarImage, turretImage, ART_GATE_SOLAR_DOG,
  upgradeSecs, repairSecsFor, defenseScore,
} from '@/config/house'
import { troopsForParty, troopById } from '@/config/troops'
import { startAmbient, stopAmbient, ambientRunning } from '@/lib/ambient'
import { playBase, preloadBaseSfx, yardAmbience, BaseSfxName } from '@/lib/base-sfx'
import IsoYard, { IsoCellSpec, isoPos, IsoFenceLinks, fenceAdjacency } from '@/components/IsoYard'
import { IdleFxItem } from '@/components/BaseIdleFx'

// 🏠 CAMPAIGN HQ — the personal base, ISOMETRIC (Grok's presentation brief,
// 2026-07-31: "must feel like CoC — not a flat CSS grid of emoji"). The 6×6
// data model and every API are unchanged; only the stage is new: continuous
// yard background, depth-sorted sprites, HUD at the edges. Works in BOTH
// orientations — landscape is the big view, portrait scales to fit.
// PERSONAL base only — nothing here touches town-hall control.

interface Farm { ready: number; next_in_secs: number | null; rate_hours: number; cap: number }
interface Upgrade { to: number; done_at: string; rush_cost: number }
interface Building { pad: number; type: string; level: number; facing?: number; upgrade?: Upgrade | null; damaged_until?: string | null; repair_cost?: number | null }

// B8: which one-shot each /api/house action earns on success
const ACT_SOUND: Record<string, BaseSfxName> = {
  build: 'place', upgrade: 'hammer', upgrade_hq: 'hammer',
  rush: 'done', repair: 'done', claim_tower: 'claim', claim_solar: 'claim',
}
interface Tower { level: number; banked: number; next_in_secs: number; rate: number; interval_hours: number }
interface House {
  print_shop_pad?: number
  hq_level: number; hq_upgrade: Upgrade | null
  buildings: Building[]; tower: Tower | null; solar: Tower | null
  trophies: number; shield_until: string | null; pickups: number
  safe: { level: number; stored: number; capacity: number } | null
}

// compact countdown: 2h 5m, 4m 12s, 9s
function fmtLeft(doneAt: string, now: number): string {
  let s = Math.max(0, Math.floor((+new Date(doneAt) - now) / 1000))
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60); s -= m * 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// compact duration for "how long will this take": 2h, 30m, 45s
function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${secs}s`
}

// ── B9 chrome: tiny shared pieces so every sheet speaks one language ─────────

/** slim progress bar — timers get a FEEL, not just a countdown string */
function MiniBar({ pct, color = 'linear-gradient(90deg,#fbbf24,#f59e0b)', w }: { pct: number; color?: string; w?: number | string }) {
  return (
    <span className="block h-1.5 bg-black/45 rounded-full overflow-hidden mt-1" style={{ width: w ?? '100%' }}>
      <span className="block h-full rounded-full transition-[width] duration-1000 ease-linear"
        style={{ width: `${Math.max(3, Math.min(100, pct))}%`, background: color }} />
    </span>
  )
}

/** dark-glass bottom sheet shell — grabber, glow border, safe-area padding */
function GlassSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[75] bg-black/60 flex items-end" onClick={onClose}>
      <div className="w-full max-w-md mx-auto bg-[#0d1411]/95 backdrop-blur-xl rounded-t-3xl border-t border-x border-amber-400/15 p-5 max-h-[85vh] overflow-y-auto shadow-[0_-16px_48px_rgba(0,0,0,0.65)]"
        style={{ paddingBottom: 'calc(2rem + 4.5rem + env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}>
        <span className="block w-10 h-1 rounded-full bg-white/15 mx-auto mb-4" />
        {children}
      </div>
    </div>
  )
}

/** primary CTA that KNOWS the price — disables itself and says why when the
 *  player can't afford it, instead of toasting after a failed server call */
function Cta({ cost, fp, busy, onClick, children, variant = 'gold' }:
  { cost?: number; fp: number; busy: boolean; onClick: () => void; children: ReactNode; variant?: 'gold' | 'green' | 'ghost' }) {
  const broke = cost != null && fp < cost
  const bg = variant === 'gold' ? 'linear-gradient(135deg,#fbbf24,#d97706)'
    : variant === 'green' ? 'linear-gradient(135deg,#34d399,#059669)' : undefined
  return (
    <>
      <button disabled={busy || broke} onClick={onClick}
        className={`mt-3 w-full py-3 rounded-xl font-black disabled:opacity-35 active:scale-[0.98] transition-transform ${variant === 'ghost' ? 'text-white bg-gray-800 border border-gray-700 hover:border-gray-500' : 'text-black'}`}
        style={bg ? { background: bg } : undefined}>
        {children}
      </button>
      {broke && <p className="text-red-400/90 text-[11px] font-bold text-center mt-1.5">Need ⚡{(cost! - fp).toLocaleString()} more FP</p>}
    </>
  )
}

// sprite art per building type (same painterly iso language as the house)
const SPRITES: Record<string, { img: (level: number) => string; w: number }> = {
  fence: { img: () => '/house/fence2.webp', w: 118 },
  media_tower: { img: () => '/house/media_tower.webp', w: 126 },
  safe: { img: l => safeImage(l), w: 96 },
  barracks: { img: l => barracksImage(l), w: 150 },
  solar: { img: l => solarImage(l), w: 134 },
  doberman: { img: () => '/house/doberman.webp', w: 104 },
  turret: { img: l => turretImage(l), w: 118 },
}

// sparkle pickups live on fixed pads so a refresh doesn't shuffle them
const SPARKLE_PADS = [12, 37, 58, 73, 86]

export default function HqPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [farm, setFarm] = useState<Farm | null>(null)
  const [house, setHouse] = useState<House | null>(null)
  const [army, setArmy] = useState<{
    barracks_level: number; capacity: number; counts: Record<string, number>
    total: number; power: number; bonus: number
    queue: Array<{ type: string; count: number; secs_each: number; next_unit_at: string; done_at: string }>
    queued_total: number; queue_done_at: string | null; rush_cost: number
  } | null>(null)
  const [sheet, setSheet] = useState<{ pad: number; building?: Building; hq?: boolean; ps?: boolean } | null>(null)
  // B9: building type the build sheet is previewing as a ghost on the pad
  const [ghostType, setGhostType] = useState<string | null>(null)
  // menu-driven MOVE MODE (long-press drag fought Chrome's context menu):
  // the pad currently being moved, or null
  const [moving, setMoving] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const isRep = profile?.party === 'republican'
  const tint = isRep ? '#dc2626' : '#2563eb'

  const load = () => {
    fetch('/api/farm').then(r => r.json()).then(setFarm).catch(() => {})
    fetch('/api/house').then(r => r.json()).then(setHouse).catch(() => {})
    fetch('/api/house/troops').then(r => r.json()).then(setArmy).catch(() => {})
  }
  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [])

  // Preload the hero + every PLACED building's art the moment the base data
  // lands (B2 P2.4) — the yard must never pop images in as you pan/zoom
  useEffect(() => {
    if (!house) return
    const warm = new Set<string>([hqImage(house.hq_level ?? 1), '/house/print_shop.webp'])
    for (const b of house.buildings ?? []) {
      const src = SPRITES[b.type]?.img(b.level)
      if (src) warm.add(src)
    }
    for (const src of warm) { const im = new Image(); im.src = src }
  }, [house])

  // ambient music: starts on the FIRST tap (browser autoplay rules),
  // remembered across visits, stops when leaving the page.
  // B9: the B8 yard bed (wind/birds/town) gets its OWN remembered toggle —
  // it's atmosphere, not score, so the two mute independently.
  const [music, setMusic] = useState(false)
  const [amb, setAmb] = useState(false)
  const musicPref = useRef(true)
  const ambPref = useRef(true)
  useEffect(() => {
    try { musicPref.current = localStorage.getItem('hq_music') !== 'off' } catch {}
    try { ambPref.current = localStorage.getItem('hq_ambience') !== 'off' } catch {}
    const first = () => {
      if (musicPref.current && !ambientRunning()) { startAmbient(); setMusic(true) }
      if (ambPref.current && !yardAmbience.running()) { yardAmbience.start(); setAmb(true) }
      preloadBaseSfx(['claim', 'place', 'hammer', 'done', 'ready'])
      window.removeEventListener('pointerdown', first)
    }
    window.addEventListener('pointerdown', first)
    return () => { window.removeEventListener('pointerdown', first); stopAmbient(); yardAmbience.stop() }
  }, [])
  function toggleAmb() {
    if (yardAmbience.running()) { yardAmbience.stop(); setAmb(false); ambPref.current = false; try { localStorage.setItem('hq_ambience', 'off') } catch {} }
    else { yardAmbience.start(); setAmb(true); ambPref.current = true; try { localStorage.setItem('hq_ambience', 'on') } catch {} }
  }
  // B8: menus duck the yard bed (stepping indoors), and the moment something
  // first becomes claimable the yard pings — once, softly
  useEffect(() => { yardAmbience.duck(!!sheet) }, [sheet])
  // B9: no sheet, no ghost
  useEffect(() => { if (!sheet) setGhostType(null) }, [sheet])
  const farmReady = (farm?.ready ?? 0) > 0
  const prevReady = useRef(false)
  useEffect(() => {
    if (farmReady && !prevReady.current) playBase('ready')
    prevReady.current = farmReady
  }, [farmReady])

  function toggleMusic() {
    if (ambientRunning()) { stopAmbient(); setMusic(false); musicPref.current = false; try { localStorage.setItem('hq_music', 'off') } catch {} }
    else { startAmbient(); setMusic(true); musicPref.current = true; try { localStorage.setItem('hq_music', 'on') } catch {} }
  }

  function say(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // floating pad texts: sparkle pickups AND finished-timer celebrations
  const [popped, setPopped] = useState<Array<{ id: number; pad: number; text: string }>>([])
  const popId = useRef(0)
  const popAt = (pad: number, text: string, ms = 900) => {
    const id = ++popId.current
    setPopped(p => [...p, { id, pad, text }])
    setTimeout(() => setPopped(p => p.filter(x => x.id !== id)), ms)
  }

  // B9: freshly placed/moved building pops onto its pad
  const [placedPad, setPlacedPad] = useState<number | null>(null)
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bump = (pad: number) => {
    setPlacedPad(pad)
    if (bumpTimer.current) clearTimeout(bumpTimer.current)
    bumpTimer.current = setTimeout(() => setPlacedPad(null), 650)
  }

  // one ticking clock drives every countdown; only runs while something is
  // actually upgrading, and reloads state when a timer crosses zero
  const [now, setNow] = useState(Date.now())
  const anyUpgrading = !!house?.hq_upgrade || (house?.buildings ?? []).some(b => b.upgrade)
    || (army?.queue?.length ?? 0) > 0
  useEffect(() => {
    if (!anyUpgrading) return
    const iv = setInterval(() => {
      setNow(Date.now())
      // B9: celebrate ON the pad that finished, not just in the ear
      const donePads: number[] = []
      if (house?.hq_upgrade && +new Date(house.hq_upgrade.done_at) <= Date.now()) donePads.push(HQ_PAD)
      for (const b of house?.buildings ?? []) {
        if (b.upgrade && +new Date(b.upgrade.done_at) <= Date.now()) donePads.push(b.pad)
        if (b.damaged_until && +new Date(b.damaged_until) <= Date.now()) donePads.push(b.pad)
      }
      const due = donePads.length > 0
        || (army?.queue ?? []).some(q => +new Date(q.next_unit_at) <= Date.now())
      if (due) {
        playBase('done') // the server settles it; finished work lands with a chime
        for (const p of donePads) popAt(p, '✨', 1200)
        load()
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [anyUpgrading, house, army])

  // B9 desktop nicety: Escape backs out of move mode, then out of the sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (moving != null) setMoving(null)
      else if (sheet) setSheet(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moving, sheet])
  async function pickUp(pad: number) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/house', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pickup' }),
      })
      const d = await res.json()
      if (res.ok && d.claimed > 0) {
        popAt(pad, `+${d.claimed} FP`)
        playBase('claim')
        try { navigator.vibrate?.(20) } catch {}
        load(); refetch()
      } else { load() }
    } finally { setBusy(false) }
  }

  async function act(payload: Record<string, unknown>, okMsg: (d: any) => string, onOk?: (d: any) => void) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/house', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (res.ok) {
        const snd = ACT_SOUND[String(payload.action)]
        if (snd) playBase(snd)
        onOk?.(d)
        say(okMsg(d)); setSheet(null); load(); refetch()
      }
      else say(`❌ ${d.message ?? d.error ?? 'Something went wrong'}`)
    } catch { say('❌ Something went wrong') } finally { setBusy(false) }
  }

  async function claimFarm() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/farm', { method: 'POST' })
      const d = await res.json()
      if (res.ok && d.claimed > 0) { playBase('claim'); say(`🧨 +${d.claimed} firecracker${d.claimed === 1 ? '' : 's'} to your bag!`) }
      load()
    } finally { setBusy(false) }
  }

  const builtOn = new Map((house?.buildings ?? []).map(b => [b.pad, b]))
  const hasOf = (t: string) => (house?.buildings ?? []).some(b => b.type === t)

  // fences: the CELL renders only a small post — IsoFenceLinks draws the
  // panels bridging adjacent fences, so runs connect by construction
  const fencePads = new Set([...builtOn.values()]
    .filter(b => b.type === 'fence' && !(b.damaged_until && +new Date(b.damaged_until) > now))
    .map(b => b.pad))
  const fenceLinkedSet = fenceAdjacency(fencePads).linked

  // ── map game state onto the iso stage ──────────────────────────────────────
  // B9: timers get progress FEEL — the chip carries a live bar, total durations
  // recomputed client-side from the same config the server prices from
  const pctDone = (doneAt: string, totalSecs: number) =>
    100 - Math.max(0, Math.min(100, ((+new Date(doneAt) - now) / 1000 / Math.max(1, totalSecs)) * 100))
  // early yard: whisper "+" on the plots until the base has a few buildings
  const plotPlus = (house?.buildings ?? []).filter(b => b.type !== 'fence').length < 4
  const cells: IsoCellSpec[] = []
  for (let pad = 0; pad < GRID * GRID; pad++) {
    if (pad === HQ_PAD) {
      cells.push({
        pad, img: hqImage(house?.hq_level ?? 1), imgW: 198,
        onTap: () => setSheet({ pad, hq: true }),
        chip: house?.hq_upgrade
          ? <span className="flex flex-col items-center">
              <span className="text-[13px] font-black px-2 py-0.5 rounded-md bg-amber-500 text-black shadow-lg">🔨 {fmtLeft(house.hq_upgrade.done_at, now)}</span>
              <MiniBar pct={pctDone(house.hq_upgrade.done_at, upgradeSecs(house.hq_upgrade.to, true))} w={64} />
            </span>
          : <span className="text-[13px] font-black px-2 py-0.5 rounded-md shadow-lg" style={{ background: `${tint}cc`, color: '#fff' }}>Lv {house?.hq_level ?? 1}</span>,
      })
      continue
    }
    if (pad === (house?.print_shop_pad ?? PRINT_SHOP_PAD)) {
      const ready = (farm?.ready ?? 0) > 0
      cells.push({
        pad, img: '/house/print_shop.webp', imgW: 128, movable: true, bounce: placedPad === pad,
        glow: ready, onTap: ready ? claimFarm : () => setSheet({ pad, ps: true }),
        chip: ready
          ? <span className="text-[13px] font-black px-2 py-1 rounded-md bg-amber-400 text-black animate-bounce shadow-lg">🧨 CLAIM {farm!.ready}</span>
          : farm ? <span className="text-[12px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-gray-200">🧨 {Math.max(1, Math.ceil((farm.next_in_secs ?? 0) / 60))}m</span> : undefined,
      })
      continue
    }
    const b = builtOn.get(pad)
    if (b) {
      const sp = SPRITES[b.type]
      const damaged = !!b.damaged_until && +new Date(b.damaged_until) > now
      const banked = damaged ? 0
        : b.type === 'media_tower' ? (house?.tower?.banked ?? 0)
        : b.type === 'solar' ? (house?.solar?.banked ?? 0) : 0
      const stored = b.type === 'safe' ? (house?.safe?.stored ?? 0) : 0
      const isFence = b.type === 'fence'
      const linked = isFence && fenceLinkedSet.has(pad)
      cells.push({
        pad, movable: true, bounce: placedPad === pad,
        // linked fences show only the joint post (IsoFenceLinks draws the
        // panels); a lone fence keeps a small panel so it reads as a fence
        img: isFence ? (linked ? '/house/fence_post2.webp' : '/house/fence2.webp') : sp?.img(b.level),
        imgW: isFence ? (linked ? 13 : 76) : sp?.w,
        mirror: ((b.facing ?? 0) % 2) === 1,
        emoji: sp ? undefined : buildingDef(b.type)?.emoji,
        glow: banked > 0,
        idle: b.type === 'doberman' ? 'dog' : undefined, // B3: he shifts his weight
        dead: damaged,   // charred until the countdown (or a repair) clears it
        // B7: damaged buildings wear real scorch marks over the char filter
        overlay: damaged && !isFence ? '/house/fx/scorch.webp' : undefined,
        onTap: () => setSheet({ pad, building: b }),
        chip: damaged
          ? <span className="flex flex-col items-center">
              <span className="text-[12px] font-black px-1.5 py-0.5 rounded bg-orange-600 text-white shadow-lg">🔧 {fmtLeft(b.damaged_until!, now)}</span>
              <MiniBar pct={pctDone(b.damaged_until!, repairSecsFor(b.type, b.level))} w={56} color="linear-gradient(90deg,#fb923c,#ea580c)" />
            </span>
          : b.upgrade
            ? <span className="flex flex-col items-center">
                <span className="text-[12px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-black shadow-lg">🔨 {fmtLeft(b.upgrade.done_at, now)}</span>
                <MiniBar pct={pctDone(b.upgrade.done_at, upgradeSecs(b.upgrade.to))} w={56} />
              </span>
            : banked > 0
              ? <span className="text-[13px] font-black px-2 py-1 rounded-md bg-emerald-400 text-black animate-bounce shadow-lg">+{banked} FP</span>
              : stored > 0
                ? <span className="text-[12px] font-black px-1.5 py-0.5 rounded bg-black/60 text-amber-300 shadow-lg">🔐 {stored.toLocaleString()}</span>
                : <span className="text-[12px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-gray-200 shadow-lg">Lv {b.level}</span>,
      })
      continue
    }
    // empty plot — subtle diamond, tap to build
    cells.push({ pad, plot: true, plotPlus, onTap: () => setSheet({ pad }) })
  }

  const sparkles = SPARKLE_PADS.slice(0, house?.pickups ?? 0)

  // ── B3 idle life: ambient loops + claim bubbles from state we already load ──
  const idleFx: IdleFxItem[] = []
  if (house) {
    idleFx.push({ pad: HQ_PAD, kind: 'glow', dy: 66 })
    if (house.hq_upgrade) idleFx.push({ pad: HQ_PAD, kind: 'upgrade' })
    const ps = house.print_shop_pad ?? PRINT_SHOP_PAD
    idleFx.push({ pad: ps, kind: 'smoke', dx: 20, dy: 112 })
    if ((farm?.ready ?? 0) > 0) idleFx.push({ pad: ps, kind: 'ready', emoji: '🧨', dy: 130 })
    for (const b of house.buildings ?? []) {
      const damagedB = !!b.damaged_until && +new Date(b.damaged_until) > now
      if (damagedB) {
        // B7: hurt buildings SMOLDER — rising smoke sells the damage state
        if (b.type !== 'fence') idleFx.push({ pad: b.pad, kind: 'smoke', dx: 8, dy: 60 })
        continue // ...but a broken building doesn't hum its normal loops
      }
      if (b.upgrade) idleFx.push({ pad: b.pad, kind: 'upgrade' })
      if (b.type === 'media_tower') {
        idleFx.push({ pad: b.pad, kind: 'ping', dy: 146 })
        if ((house.tower?.banked ?? 0) > 0) idleFx.push({ pad: b.pad, kind: 'ready', emoji: '⚡', dy: 170 })
      }
      if (b.type === 'solar') {
        idleFx.push({ pad: b.pad, kind: 'glint', dy: 46 })
        if ((house.solar?.banked ?? 0) > 0) idleFx.push({ pad: b.pad, kind: 'ready', emoji: '☀️', dy: 96 })
      }
      if (b.type === 'barracks' && (army?.queue?.length ?? 0) > 0) {
        idleFx.push({ pad: b.pad, kind: 'dust', dx: -24, dy: 12 })
      }
    }
  }

  // every empty cell is a legal landing spot (not the house, not occupied)
  const psPad = house?.print_shop_pad ?? PRINT_SHOP_PAD
  const validTargets = new Set<number>()
  for (let pad = 0; pad < GRID * GRID; pad++) {
    if (pad === HQ_PAD || pad === psPad || builtOn.has(pad)) continue
    validTargets.add(pad)
  }

  // ── B9 P3: "what should I do?" — one glance, one line ──────────────────────
  const fp = profile?.fp_balance ?? 0
  const defScore = house ? defenseScore(
    house.buildings.map(b => ({ type: b.type, level: b.level, damaged: !!b.damaged_until && +new Date(b.damaged_until) > now })),
    house.hq_level ?? 1,
  ) : 0
  const damagedCount = (house?.buildings ?? []).filter(b => b.damaged_until && +new Date(b.damaged_until) > now).length
  const incomeReady = (farm?.ready ?? 0) > 0 || (house?.tower?.banked ?? 0) > 0
    || (house?.solar?.banked ?? 0) > 0 || (house?.pickups ?? 0) > 0
  const canUpgradeSomething = !anyUpgrading && house != null && (
    (hqUpgradeCost(house.hq_level ?? 1) ?? Infinity) <= fp
    || house.buildings.some(b => {
      if (b.type === 'fence' || b.upgrade) return false
      const c = buildingCost(b.type, b.level + 1)
      return c != null && c <= fp
    })
  )
  const hint = !house ? null
    : damagedCount > 0 ? `🔧 ${damagedCount} building${damagedCount === 1 ? '' : 's'} repairing — tap one to fix it now`
    : incomeReady ? '⚡ Income is waiting — tap the glowing buildings'
    : hasOf('barracks') && army != null && army.total + (army.queued_total ?? 0) === 0 ? '🎖️ Your army is empty — train troops before you raid'
    : canUpgradeSomething ? '🔨 You can afford an upgrade right now'
    : null
  const [hintDismissed, setHintDismissed] = useState<string | null>(null)
  // training keeps the sheet OPEN — it's a multi-tap flow
  async function train(type: string, count: number) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/house/troops', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, count }),
      })
      const d = await res.json()
      if (!res.ok) say(`❌ ${d.message ?? d.error ?? 'Could not train'}`)
      else {
        playBase('place')
        try { navigator.vibrate?.(12) } catch {}
        say(`🎖️ Queued ${d.queued}! (-${d.spent} FP)`)
        load(); refetch()
      }
    } catch { say('❌ Could not train') } finally { setBusy(false) }
  }

  async function rushTroops() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/house/troops', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rush: true }),
      })
      const d = await res.json()
      if (!res.ok) say(`❌ ${d.message ?? d.error ?? 'Could not rush'}`)
      else { say(`⚡ Troops ready! (-${d.spent} FP)`); load(); refetch() }
    } catch { say('❌ Could not rush') } finally { setBusy(false) }
  }

  // ── B10: share the base — canvas poster → native share, blob-download
  // fallback. Same-origin art only, so the canvas never taints. ──
  const [snapping, setSnapping] = useState(false)
  async function shareBase() {
    if (!house || snapping) return
    setSnapping(true)
    try {
      const blob = await snapshotBase({
        buildings: house.buildings.map(b => ({
          pad: b.pad, type: b.type, level: b.level, facing: b.facing,
          damaged: !!b.damaged_until && +new Date(b.damaged_until) > now,
        })),
        hqLevel: house.hq_level ?? 1,
        printShopPad: house.print_shop_pad ?? PRINT_SHOP_PAD,
        name: profile?.username ?? 'My',
        tint, defScore, trophies: house.trophies ?? 0,
      })
      const caption = `My base on PoliticsGo — come build yours and try to raid me! ${window.location.origin}`
      const file = new File([blob], 'politicsgo-base.png', { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], text: caption, title: 'PoliticsGo' })
        playBase('done')
      } else {
        // TWA/desktop fallback: save the PNG, park the caption on the clipboard
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'politicsgo-base.png'; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
        try { await navigator.clipboard.writeText(caption) } catch {}
        playBase('done')
        say('📸 Snapshot saved! Caption copied — paste it anywhere.')
      }
    } catch (e) {
      // user closing the share sheet is not an error
      if ((e as { name?: string })?.name !== 'AbortError') say('❌ Could not build the snapshot')
    } finally { setSnapping(false) }
  }

  // optimistic quarter-turn; the server owns the persisted value
  async function rotateBuilding(pad: number) {
    setHouse(h => h ? { ...h, buildings: h.buildings.map(b => b.pad === pad ? { ...b, facing: ((b.facing ?? 0) + 1) % 4 } : b) } : h)
    try {
      const res = await fetch('/api/house', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate', pad }),
      })
      if (!res.ok) load()
      else { try { navigator.vibrate?.(10) } catch {} }
    } catch { load() }
  }
  async function moveBuilding(from: number, to: number) {
    try {
      const res = await fetch('/api/house', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', from_pad: from, to_pad: to }),
      })
      const d = await res.json()
      if (!res.ok) say(`❌ ${d.error ?? 'Could not move'}`)
      else {
        playBase('place'); bump(to) // B9: landing pops + thunks
        try { navigator.vibrate?.(15) } catch {}
      }
    } catch { say('❌ Could not move') }
    load()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#0d1512] text-gray-200 select-none">
      {/* the yard stops above the bottom nav — the bar stays (Michael) */}
      <div className="absolute inset-x-0 top-0" style={{ bottom: '4.5rem' }}>
      <IsoYard cells={cells} bg="/house/yard_bg2.webp" idleFx={idleFx} validTargets={validTargets} movingFrom={moving}
        highlightPad={sheet && !sheet.hq && !sheet.ps && !sheet.building ? sheet.pad : null}
        ghost={sheet && !sheet.hq && !sheet.ps && !sheet.building && ghostType && SPRITES[ghostType]
          ? { pad: sheet.pad, img: SPRITES[ghostType].img(1), imgW: SPRITES[ghostType].w } : null}
        onMove={(f, t) => { setMoving(null); moveBuilding(f, t) }}>
        <IsoFenceLinks fencePads={fencePads} />
        {/* sparkle pickups + their pops, in stage coordinates */}
        {sparkles.map(pad => {
          const { x, y, depth } = isoPos(pad)
          return (
            <button key={`s${pad}`} onClick={() => pickUp(pad)}
              className="absolute text-2xl animate-pulse active:scale-75 transition -translate-x-1/2 -translate-y-1/2"
              style={{ left: x, top: y - 8, zIndex: depth * 10 + 5 }}>✨</button>
          )
        })}
        {popped.map(p => {
          const { x, y } = isoPos(p.pad)
          return (
            <span key={p.id} className="absolute text-yellow-300 font-black text-base animate-bounce pointer-events-none -translate-x-1/2"
              style={{ left: x, top: y - 46, zIndex: 1600 }}>{p.text}</span>
          )
        })}
      </IsoYard>
      </div>

      {/* ── HUD: chrome at the edges, buttons clear of the bottom bar ── */}
      <div className="absolute top-3 left-3 z-[70] flex items-center gap-2">
        <button onClick={() => router.back()} className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center text-gray-200"><ArrowLeft size={17} /></button>
        <button onClick={toggleMusic} aria-label="music" className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center text-gray-200">
          {music ? <Music size={15} /> : <VolumeX size={15} />}
        </button>
        {/* B9: the B8 nature bed gets its own remembered mute */}
        <button onClick={toggleAmb} aria-label="ambience" className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center">
          <Leaf size={15} className={amb ? 'text-emerald-400' : 'text-gray-600'} />
        </button>
        {/* B10: one tap → a poster of your base in the share sheet */}
        <button onClick={shareBase} disabled={snapping || !house} aria-label="share base"
          className={`w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center text-gray-200 disabled:opacity-40 ${snapping ? 'animate-pulse' : ''}`}>
          <Share2 size={15} />
        </button>
      </div>
      <div className="absolute top-3 right-3 z-[70] flex items-center gap-1.5">
        {(army?.capacity ?? 0) > 0 && (
          <span className="px-2.5 py-1.5 rounded-xl bg-black/50 backdrop-blur text-emerald-300 font-black text-[13px]">🎖️ {army!.total}/{army!.capacity}{(army!.queued_total ?? 0) > 0 ? <span className="text-amber-300"> +{army!.queued_total}⏳</span> : null}</span>
        )}
        {defScore > 0 && (
          <span className="px-2.5 py-1.5 rounded-xl bg-black/50 backdrop-blur text-sky-300 font-black text-[13px]">🛡️ {defScore}</span>
        )}
        <span className="px-2.5 py-1.5 rounded-xl bg-black/50 backdrop-blur text-amber-400 font-black text-[13px]">🏆 {house?.trophies ?? 0}</span>
        <span className="px-2.5 py-1.5 rounded-xl bg-black/50 backdrop-blur text-yellow-400 font-black text-[13px]">⚡ {fp.toLocaleString()}</span>
      </div>
      {/* B9 P3: one-line "next thing" hint — dismissible, never a tutorial */}
      {hint && hint !== hintDismissed && moving == null && !sheet && (
        <button onClick={() => setHintDismissed(hint)}
          className="absolute top-14 left-1/2 -translate-x-1/2 z-[65] max-w-[92%] px-3 py-1.5 rounded-full bg-black/55 backdrop-blur border border-white/10 text-gray-200 text-xs font-bold whitespace-nowrap overflow-hidden text-ellipsis active:scale-95">
          {hint} <span className="text-gray-500 ml-1">✕</span>
        </button>
      )}
      {house?.shield_until && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[65] px-3 py-1.5 rounded-xl bg-sky-950/80 backdrop-blur border border-sky-700 text-sky-300 text-xs font-bold">
          🛡️ Shielded until {new Date(house.shield_until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
      )}
      {moving != null && (() => {
        const mb = builtOn.get(moving)
        const name = mb ? buildingDef(mb.type)?.name ?? 'Building' : 'Print Shop'
        return (
          <div className="absolute left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 whitespace-nowrap" style={{ bottom: '5.5rem' }}>
            <span className="px-3 py-2.5 rounded-xl bg-black/75 backdrop-blur text-white text-xs font-bold shadow-xl">
              Moving {name} — tap a green square
            </span>
            {mb && (
              <button onClick={() => rotateBuilding(moving)}
                className="w-11 h-11 rounded-xl bg-amber-400 text-black text-xl shadow-xl active:scale-90 active:rotate-90 transition-transform">🔄</button>
            )}
            <button onClick={() => setMoving(null)}
              className="w-11 h-11 rounded-xl bg-gray-800 border border-gray-600 text-white font-black shadow-xl active:scale-90">✕</button>
          </div>
        )
      })()}
      {moving == null && <div className="absolute right-3 z-[70]" style={{ bottom: '5.5rem' }}>
        <button onClick={() => router.push('/hq/raid')}
          className="px-6 py-3.5 rounded-2xl font-black text-white text-base shadow-xl active:scale-95"
          style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
          ⚔️ FIND A RAID
        </button>
      </div>}
      {moving == null && <div className="absolute left-3 z-[70]" style={{ bottom: '5.5rem' }}>
        <button onClick={() => router.push('/collection')}
          className="px-4 py-3.5 rounded-2xl font-black text-sm bg-black/50 backdrop-blur text-white flex items-center gap-2 active:scale-95">
          <Trophy size={16} style={{ color: tint }} /> Collection
        </button>
      </div>}

      {/* build / manage sheet — B9: dark glass, one hierarchy, prices that
          answer "can I?" BEFORE the server does */}
      {sheet && (
        <GlassSheet onClose={() => setSheet(null)}>
            {sheet.hq ? (() => {
              const lvl = house?.hq_level ?? 1
              const cost = hqUpgradeCost(lvl)
              return (
                <>
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hqImage(lvl)} alt="" className="w-24 h-24 object-contain" />
                    <div>
                      <p className="text-white font-black text-lg">Your House <span className="text-amber-400/90 text-sm font-black ml-1">Lv {lvl}</span></p>
                      <p className="text-gray-400 text-xs mt-1">{lvl >= HQ_MAX_LEVEL ? 'The crystal manor — as good as it gets.' : 'A better house defends your whole base.'}</p>
                    </div>
                  </div>
                  {house?.hq_upgrade ? (
                    <div className="mt-4">
                      <div className="bg-black/30 rounded-xl p-3 border border-amber-500/25">
                        <div className="flex items-center justify-between">
                          <span className="text-amber-300 font-black text-sm">🔨 Upgrading to Lv {house.hq_upgrade.to}</span>
                          <span className="text-white font-black text-sm">{fmtLeft(house.hq_upgrade.done_at, now)}</span>
                        </div>
                        <MiniBar pct={pctDone(house.hq_upgrade.done_at, upgradeSecs(house.hq_upgrade.to, true))} />
                      </div>
                      <Cta cost={house.hq_upgrade.rush_cost} fp={fp} busy={busy}
                        onClick={() => act({ action: 'rush', hq: true }, d => `⚡ Finished instantly! (-${d.spent} FP)`)}>
                        ⚡ FINISH NOW — {house.hq_upgrade.rush_cost.toLocaleString()} FP
                      </Cta>
                    </div>
                  ) : cost != null && (
                    <>
                      <div className="mt-4 flex items-center gap-3 bg-black/30 rounded-xl p-3 border border-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={hqImage(lvl + 1)} alt="" className="w-16 h-16 object-contain" />
                        <p className="text-gray-400 text-xs">Next: <span className="text-white font-bold">Level {lvl + 1}</span> — stronger defense, better looks
                          <span className="block mt-0.5 text-gray-500">⚡{cost.toLocaleString()} · ⏱ {fmtDur(upgradeSecs(lvl + 1, true))}</span></p>
                      </div>
                      <Cta cost={cost} fp={fp} busy={busy}
                        onClick={() => act({ action: 'upgrade_hq' }, d => `🔨 Upgrade started! Done in ${Math.round(d.secs / 3600 * 10) / 10}h (-${d.spent} FP)`)}>
                        Upgrade to Lv {lvl + 1} — ⚡{cost.toLocaleString()} · ⏱ {fmtDur(upgradeSecs(lvl + 1, true))}
                      </Cta>
                    </>
                  )}
                </>
              )
            })() : sheet.ps ? (
              <>
                <p className="text-white font-black text-lg">🧨 Print Shop</p>
                <p className="text-gray-400 text-xs mt-1">Cranks out pamphlet bundles on its own — come back and claim them.</p>
                {farm && (
                  <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/10">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-amber-300">🧨 {farm.ready}/{farm.cap} bundles ready</span>
                      <span className="text-gray-500">{farm.ready >= farm.cap ? 'full — claim to restart' : farm.next_in_secs != null ? `next in ${fmtDur(Math.max(1, farm.next_in_secs))}` : ''}</span>
                    </div>
                    {farm.ready < farm.cap && farm.next_in_secs != null && (
                      <MiniBar pct={100 - (farm.next_in_secs / Math.max(1, farm.rate_hours * 3600)) * 100} />
                    )}
                  </div>
                )}
                <Cta fp={fp} busy={busy} variant="ghost" onClick={() => { setMoving(sheet.pad); setSheet(null) }}>
                  📦 MOVE — pick a new spot
                </Cta>
              </>
            ) : sheet.building ? (() => {
              const def = buildingDef(sheet.building!.type)!
              const isTower = def.type === 'media_tower'
              const isSafe = def.type === 'safe'
              const maxLv = isTower ? TOWER_MAX_LEVEL : def.costs.length
              const nextCost = buildingCost(def.type, sheet.building!.level + 1)
              const dmgB = (house?.buildings ?? []).find(x => x.pad === sheet.pad)
              const isDamaged = !!dmgB?.damaged_until && +new Date(dmgB.damaged_until) > now
              const thumb = SPRITES[def.type]?.img(sheet.building!.level)
              // damaged: the repair path IS the sheet — nothing else competes
              if (isDamaged) return (
                <>
                  <div className="flex items-center gap-4">
                    {thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumb} alt="" className="w-20 h-20 object-contain" style={{ filter: 'grayscale(0.8) brightness(0.55) sepia(0.3)' }} />
                      : <span className="text-4xl">{def.emoji}</span>}
                    <div>
                      <p className="text-white font-black text-lg">{def.name} <span className="text-orange-400 text-sm">damaged</span></p>
                      <p className="text-gray-400 text-xs mt-1">Raiders wrecked it. It repairs itself on the countdown — or pay the crew to fix it now.</p>
                    </div>
                  </div>
                  <div className="mt-4 bg-black/30 rounded-xl p-3 border border-orange-500/30">
                    <div className="flex items-center justify-between">
                      <span className="text-orange-300 font-black text-sm">🔧 Repairing</span>
                      <span className="text-white font-black text-sm">{fmtLeft(dmgB!.damaged_until!, now)}</span>
                    </div>
                    <MiniBar pct={pctDone(dmgB!.damaged_until!, repairSecsFor(def.type, sheet.building!.level))} color="linear-gradient(90deg,#fb923c,#ea580c)" />
                  </div>
                  <Cta cost={dmgB?.repair_cost ?? 0} fp={fp} busy={busy}
                    onClick={() => act({ action: 'repair', pad: sheet.pad }, d => d.spent > 0 ? `🔧 Fixed! (-${d.spent} FP)` : '🔧 Fixed!')}>
                    🔧 REPAIR NOW — {(dmgB?.repair_cost ?? 0).toLocaleString()} FP
                  </Cta>
                </>
              )
              return (
                <>
                  <div className="flex items-center gap-4">
                    {thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumb} alt="" className="w-20 h-20 object-contain" />
                      : <span className="text-4xl">{def.emoji}</span>}
                    <div className="min-w-0">
                      <p className="text-white font-black text-lg">{def.name} <span className="text-amber-400/90 text-sm font-black ml-1">Lv {sheet.building!.level}{sheet.building!.level >= maxLv ? ' · MAX' : ''}</span></p>
                      <p className="text-gray-400 text-xs mt-1">{def.desc}</p>
                    </div>
                  </div>
                  {isSafe && house?.safe && (() => {
                    const st = house.safe!
                    const pct = Math.min(100, Math.round((st.stored / Math.max(1, st.capacity)) * 100))
                    const onHand = profile?.fp_balance ?? 0
                    const room = Math.max(0, st.capacity - st.stored)
                    return (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-amber-300">🔐 {st.stored.toLocaleString()} locked</span>
                          <span className="text-gray-500">{st.capacity.toLocaleString()} max</span>
                        </div>
                        <div className="mt-1.5 h-2.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#f59e0b,#fbbf24)' }} />
                        </div>
                        <p className="text-gray-600 text-[10px] mt-1.5">Raiders can never touch FP in the safe — but you can't spend it until you take it out.</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button disabled={busy || room <= 0 || onHand <= 0}
                            onClick={() => act({ action: 'safe_deposit', amount: Math.min(room, onHand) }, d => `🔐 Locked up! Safe holds ${d.stored.toLocaleString()} FP`)}
                            className="py-3 rounded-xl font-black text-black disabled:opacity-35"
                            style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }}>
                            LOCK MAX ({Math.min(room, onHand).toLocaleString()})
                          </button>
                          <button disabled={busy || st.stored <= 0}
                            onClick={() => act({ action: 'safe_withdraw', amount: st.stored }, () => `💰 Withdrew everything — spend it or lose it`)}
                            className="py-3 rounded-xl font-black text-white bg-gray-800 border border-gray-700 disabled:opacity-35">
                            TAKE ALL OUT
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                  {isTower && house?.tower && (
                    <button disabled={busy || (house.tower.banked ?? 0) <= 0}
                      onClick={() => act({ action: 'claim_tower' }, d => `📡 +${d.claimed} FP from the airwaves!`)}
                      className="mt-4 w-full py-3 rounded-xl font-black text-black disabled:opacity-35"
                      style={{ background: 'linear-gradient(135deg,#34d399,#059669)' }}>
                      {house.tower.banked > 0 ? `CLAIM ${house.tower.banked} FP` : `Broadcasting… ${house.tower.rate} FP every ${house.tower.interval_hours}h`}
                    </button>
                  )}
                  {def.type === 'solar' && house?.solar && (
                    <button disabled={busy || (house.solar.banked ?? 0) <= 0}
                      onClick={() => act({ action: 'claim_solar' }, d => `☀️ +${d.claimed} FP of sunshine!`)}
                      className="mt-4 w-full py-3 rounded-xl font-black text-black disabled:opacity-35"
                      style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)' }}>
                      {house.solar.banked > 0 ? `CLAIM ${house.solar.banked} FP` : `Charging… ${house.solar.rate} FP every ${house.solar.interval_hours}h (stores 4)`}
                    </button>
                  )}
                  {def.type === 'barracks' && (() => {
                    const lvl = sheet.building!.level
                    const roster = troopsForParty(profile?.party ?? 'republican')
                    const queued = army?.queued_total ?? 0
                    const room = armyCap(lvl) - (army?.total ?? 0) - queued
                    return (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-emerald-300">🎖️ Army {army?.total ?? 0}/{armyCap(lvl)}{queued > 0 && <span className="text-amber-300"> +{queued} training</span>}</span>
                          <span className="text-gray-500">raids hit +{army?.bonus ?? 0} harder</span>
                        </div>
                        <div className="mt-1.5 h-2.5 bg-gray-800 rounded-full overflow-hidden flex">
                          <div className="h-full" style={{ width: `${Math.min(100, Math.round(((army?.total ?? 0) / Math.max(1, armyCap(lvl))) * 100))}%`, background: 'linear-gradient(90deg,#34d399,#059669)' }} />
                          <div className="h-full" style={{ width: `${Math.min(100, Math.round((queued / Math.max(1, armyCap(lvl))) * 100))}%`, background: 'repeating-linear-gradient(45deg,#f59e0b,#f59e0b 4px,#b45309 4px,#b45309 8px)' }} />
                        </div>
                        {(army?.queue?.length ?? 0) > 0 && (
                          <div className="mt-3 bg-black/30 rounded-xl border border-amber-500/25 p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-amber-300 font-black text-sm">🔨 Training</span>
                              <span className="text-white font-black text-sm">next in {fmtLeft(army!.queue[0].next_unit_at, now)}</span>
                            </div>
                            <MiniBar pct={pctDone(army!.queue[0].next_unit_at, Math.max(1, army!.queue[0].secs_each))} />
                            <div className="mt-2 flex items-center gap-2 overflow-x-auto">
                              {army!.queue.map((q, i) => {
                                const qd = troopById(q.type)
                                return (
                                  <span key={i} className="shrink-0 relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={qd?.img} alt="" className="w-9 h-9 object-contain opacity-80" />
                                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 rounded-full bg-gray-900 border border-gray-600 text-[10px] font-black text-gray-200 flex items-center justify-center">{q.count}</span>
                                  </span>
                                )
                              })}
                              <span className="text-gray-500 text-[11px] font-bold whitespace-nowrap ml-1">all done in {fmtLeft(army!.queue_done_at!, now)}</span>
                            </div>
                            <Cta cost={Math.max(1, army?.rush_cost ?? 0)} fp={fp} busy={busy || (army?.rush_cost ?? 0) <= 0} onClick={rushTroops}>
                              ⚡ FINISH NOW — {(army?.rush_cost ?? 0).toLocaleString()} FP
                            </Cta>
                          </div>
                        )}
                        {room < 1 && (
                          <p className="mt-3 text-center text-[11px] font-bold text-amber-400/80">Army full — raid with them, or upgrade the Barracks for room</p>
                        )}
                        <div className="mt-3 space-y-2">
                          {roster.map(tr => {
                            const locked = lvl < tr.unlockLevel
                            const n = army?.counts?.[tr.id] ?? 0
                            return (
                              <div key={tr.id} className={`bg-gray-800 rounded-xl border border-gray-700 p-2.5 flex items-center gap-3 ${locked ? 'opacity-45' : ''}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={tr.img} alt="" className="w-14 h-14 object-contain shrink-0" />
                                <span className="flex-1 min-w-0">
                                  <span className="text-white font-bold text-sm block">{tr.emoji} {tr.name}{n > 0 && <span className="text-emerald-400 font-black"> ×{n}</span>}</span>
                                  <span className="text-amber-300/90 text-[11px] font-bold block">{tr.attack}</span>
                                  <span className="text-gray-500 text-[10px] block">{tr.desc}</span>
                                </span>
                                {locked ? (
                                  <span className="text-[11px] font-black text-gray-500 whitespace-nowrap shrink-0">🔒 Barracks Lv {tr.unlockLevel}</span>
                                ) : (
                                  <span className="flex flex-col items-end gap-1 shrink-0">
                                    <button disabled={busy || room < 1 || fp < tr.cost} onClick={() => train(tr.id, 1)}
                                      className="px-2.5 py-1.5 rounded-lg font-black text-black text-xs disabled:opacity-35"
                                      style={{ background: 'linear-gradient(135deg,#34d399,#059669)' }}>+1 ⚡{tr.cost}</button>
                                    <button disabled={busy || room < 5 || fp < tr.cost * 5} onClick={() => train(tr.id, 5)}
                                      className="px-2.5 py-1 rounded-lg font-black text-white text-[10px] bg-gray-700 disabled:opacity-35">+5 ⚡{tr.cost * 5}</button>
                                    <span className="text-[9px] text-gray-500 font-bold">{tr.trainSecs >= 60 ? `${Math.round(tr.trainSecs / 60)}m` : `${tr.trainSecs}s`} each</span>
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <p className="text-gray-600 text-[10px] mt-2">Your whole army raids with you automatically. Tanks fall first, Support keeps losses down — retrain the fallen. Upgrade the Barracks for new troop types and a bigger army.</p>
                      </div>
                    )
                  })()}
                  {(() => {
                    const up = (house?.buildings ?? []).find(x => x.pad === sheet.pad)?.upgrade
                    if (up) return (
                      <div className="mt-3">
                        <div className="bg-black/30 rounded-xl p-3 border border-amber-500/25">
                          <div className="flex items-center justify-between">
                            <span className="text-amber-300 font-black text-sm">🔨 Upgrading to Lv {up.to}</span>
                            <span className="text-white font-black text-sm">{fmtLeft(up.done_at, now)}</span>
                          </div>
                          <MiniBar pct={pctDone(up.done_at, upgradeSecs(up.to))} />
                        </div>
                        <Cta cost={up.rush_cost} fp={fp} busy={busy}
                          onClick={() => act({ action: 'rush', pad: sheet.pad }, d => `⚡ Finished instantly! (-${d.spent} FP)`)}>
                          ⚡ FINISH NOW — {up.rush_cost.toLocaleString()} FP
                        </Cta>
                      </div>
                    )
                    if (sheet.building!.level < maxLv && nextCost != null) return (
                      <Cta cost={nextCost} fp={fp} busy={busy}
                        onClick={() => act({ action: 'upgrade', pad: sheet.pad }, d => `🔨 Upgrade started! Done in ${d.secs >= 3600 ? Math.round(d.secs / 360) / 10 + 'h' : Math.round(d.secs / 60) + 'm'} (-${d.spent} FP)`)}>
                        Upgrade to Lv {sheet.building!.level + 1} — ⚡{nextCost.toLocaleString()} · ⏱ {fmtDur(upgradeSecs(sheet.building!.level + 1))}
                      </Cta>
                    )
                    return <p className="mt-3 text-center text-[11px] font-bold text-amber-400/70">★ Max level</p>
                  })()}
                  <Cta fp={fp} busy={busy} variant="ghost" onClick={() => { setMoving(sheet.pad); setSheet(null) }}>
                    📦 MOVE — pick a new spot, rotate while you&apos;re at it
                  </Cta>
                </>
              )
            })() : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-white font-black text-lg">Build here</p>
                  <span className="text-yellow-400 font-black text-sm">⚡ {fp.toLocaleString()}</span>
                </div>
                <p className="text-gray-500 text-[11px] mt-0.5">New buildings finish instantly.</p>
                <div className="mt-3 space-y-2">
                  {Object.values(BUILDINGS)
                    .filter(def => !(ART_GATE_SOLAR_DOG && (def.type === 'solar' || def.type === 'doberman')))
                    .map(def => {
                    const owned = def.unique && hasOf(def.type)
                    const cost = def.costs[0]
                    const broke = fp < cost
                    const thumb = SPRITES[def.type]?.img(1)
                    // unique + already standing → a locked row, not a dead button
                    if (owned) return (
                      <div key={def.type} className="w-full bg-black/25 rounded-xl border border-white/5 p-3 flex items-center gap-3 opacity-50">
                        {thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={thumb} alt="" className="w-12 h-12 object-contain" />
                          : <span className="text-2xl">{def.emoji}</span>}
                        <span className="flex-1 min-w-0">
                          <span className="text-white font-bold text-sm block">{def.name}</span>
                          <span className="text-gray-500 text-[11px]">{def.desc}</span>
                        </span>
                        <span className="text-[11px] font-black text-gray-400 whitespace-nowrap shrink-0">🔒 Already built</span>
                      </div>
                    )
                    return (
                      <button key={def.type} disabled={busy || broke}
                        onMouseEnter={() => setGhostType(def.type)}
                        onMouseLeave={() => setGhostType(g => (g === def.type ? null : g))}
                        onClick={() => act({ action: 'build', pad: sheet.pad, type: def.type },
                          d => `${def.emoji} ${def.name} built! (-${d.spent} FP)`, () => bump(sheet.pad))}
                        className="w-full bg-black/30 rounded-xl border border-white/10 p-3 flex items-center gap-3 hover:border-amber-400/40 disabled:opacity-45 text-left active:scale-[0.99] transition-transform">
                        {thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={thumb} alt="" className="w-12 h-12 object-contain" />
                          : <span className="text-2xl">{def.emoji}</span>}
                        <span className="flex-1 min-w-0">
                          <span className="text-white font-bold text-sm block">{def.name}</span>
                          <span className="text-gray-500 text-[11px]">{def.desc}</span>
                          {broke && <span className="block text-red-400/90 text-[10px] font-bold mt-0.5">Need ⚡{(cost - fp).toLocaleString()} more</span>}
                        </span>
                        <span className={`font-black text-sm shrink-0 ${broke ? 'text-red-400/80' : 'text-yellow-400'}`}>⚡{cost.toLocaleString()}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
        </GlassSheet>
      )}

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 z-[70] max-w-md w-[90%]" style={{ bottom: '8.5rem' }}>
          <div className="bg-gray-800/95 backdrop-blur text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
        </div>
      )}
    </div>
  )
}

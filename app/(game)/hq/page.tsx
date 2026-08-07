'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trophy, Music, VolumeX } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import {
  GRID, HQ_PAD, PRINT_SHOP_PAD, BUILDINGS,
  buildingDef, buildingCost, TOWER_MAX_LEVEL,
  hqImage, hqUpgradeCost, HQ_MAX_LEVEL,
  safeImage, barracksImage, armyCap,
} from '@/config/house'
import { troopsForParty } from '@/config/troops'
import { startAmbient, stopAmbient, ambientRunning } from '@/lib/ambient'
import IsoYard, { IsoCellSpec, isoPos, IsoFenceLinks } from '@/components/IsoYard'

// 🏠 CAMPAIGN HQ — the personal base, ISOMETRIC (Grok's presentation brief,
// 2026-07-31: "must feel like CoC — not a flat CSS grid of emoji"). The 6×6
// data model and every API are unchanged; only the stage is new: continuous
// yard background, depth-sorted sprites, HUD at the edges. Works in BOTH
// orientations — landscape is the big view, portrait scales to fit.
// PERSONAL base only — nothing here touches town-hall control.

interface Farm { ready: number; next_in_secs: number | null; rate_hours: number; cap: number }
interface Upgrade { to: number; done_at: string; rush_cost: number }
interface Building { pad: number; type: string; level: number; facing?: number; upgrade?: Upgrade | null }
interface Tower { level: number; banked: number; next_in_secs: number; rate: number; interval_hours: number }
interface House {
  print_shop_pad?: number
  hq_level: number; hq_upgrade: Upgrade | null
  buildings: Building[]; tower: Tower | null
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

// sprite art per building type (same painterly iso language as the house)
const SPRITES: Record<string, { img: (level: number) => string; w: number }> = {
  fence: { img: () => '/house/fence.png', w: 118 },
  media_tower: { img: () => '/house/media_tower.png', w: 126 },
  safe: { img: l => safeImage(l), w: 96 },
  barracks: { img: l => barracksImage(l), w: 150 },
}

// sparkle pickups live on fixed pads so a refresh doesn't shuffle them
const SPARKLE_PADS = [12, 37, 58, 73, 86]

export default function HqPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [farm, setFarm] = useState<Farm | null>(null)
  const [house, setHouse] = useState<House | null>(null)
  const [army, setArmy] = useState<{ barracks_level: number; capacity: number; counts: Record<string, number>; total: number; power: number; bonus: number } | null>(null)
  const [sheet, setSheet] = useState<{ pad: number; building?: Building; hq?: boolean; ps?: boolean } | null>(null)
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

  // ambient music: starts on the FIRST tap (browser autoplay rules),
  // remembered across visits, stops when leaving the page
  const [music, setMusic] = useState(false)
  const musicPref = useRef(true)
  useEffect(() => {
    try { musicPref.current = localStorage.getItem('hq_music') !== 'off' } catch {}
    const first = () => {
      if (musicPref.current && !ambientRunning()) { startAmbient(); setMusic(true) }
      window.removeEventListener('pointerdown', first)
    }
    window.addEventListener('pointerdown', first)
    return () => { window.removeEventListener('pointerdown', first); stopAmbient() }
  }, [])
  function toggleMusic() {
    if (ambientRunning()) { stopAmbient(); setMusic(false); musicPref.current = false; try { localStorage.setItem('hq_music', 'off') } catch {} }
    else { startAmbient(); setMusic(true); musicPref.current = true; try { localStorage.setItem('hq_music', 'on') } catch {} }
  }

  function say(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // one ticking clock drives every countdown; only runs while something is
  // actually upgrading, and reloads state when a timer crosses zero
  const [now, setNow] = useState(Date.now())
  const anyUpgrading = !!house?.hq_upgrade || (house?.buildings ?? []).some(b => b.upgrade)
  useEffect(() => {
    if (!anyUpgrading) return
    const iv = setInterval(() => {
      setNow(Date.now())
      const due = [house?.hq_upgrade?.done_at, ...(house?.buildings ?? []).map(b => b.upgrade?.done_at)]
        .some(d => d && +new Date(d) <= Date.now())
      if (due) load() // the server settles it and the scaffolding comes down
    }, 1000)
    return () => clearInterval(iv)
  }, [anyUpgrading, house])

  // sparkle pickups — each tap is a real server grant, popped at its pad
  const [popped, setPopped] = useState<Array<{ id: number; pad: number; text: string }>>([])
  const popId = useRef(0)
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
        const id = ++popId.current
        setPopped(p => [...p, { id, pad, text: `+${d.claimed} FP` }])
        setTimeout(() => setPopped(p => p.filter(x => x.id !== id)), 900)
        try { navigator.vibrate?.(20) } catch {}
        load(); refetch()
      } else { load() }
    } finally { setBusy(false) }
  }

  async function act(payload: Record<string, unknown>, okMsg: (d: any) => string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/house', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (res.ok) { say(okMsg(d)); setSheet(null); load(); refetch() }
      else say(`❌ ${d.message ?? d.error ?? 'Something went wrong'}`)
    } catch { say('❌ Something went wrong') } finally { setBusy(false) }
  }

  async function claimFarm() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/farm', { method: 'POST' })
      const d = await res.json()
      if (res.ok && d.claimed > 0) say(`🧨 +${d.claimed} firecracker${d.claimed === 1 ? '' : 's'} to your bag!`)
      load()
    } finally { setBusy(false) }
  }

  const builtOn = new Map((house?.buildings ?? []).map(b => [b.pad, b]))
  const hasOf = (t: string) => (house?.buildings ?? []).some(b => b.type === t)

  // fences: the CELL renders only a small post — IsoFenceLinks draws the
  // panels bridging adjacent fences, so runs connect by construction
  const fencePads = new Set([...builtOn.values()].filter(b => b.type === 'fence').map(b => b.pad))
  const fenceLinked = (pad: number) => {
    const col = pad % GRID, row = Math.floor(pad / GRID)
    return (col > 0 && fencePads.has(pad - 1)) || (col < GRID - 1 && fencePads.has(pad + 1))
      || (row > 0 && fencePads.has(pad - GRID)) || (row < GRID - 1 && fencePads.has(pad + GRID))
  }

  // ── map game state onto the iso stage ──────────────────────────────────────
  const cells: IsoCellSpec[] = []
  for (let pad = 0; pad < GRID * GRID; pad++) {
    if (pad === HQ_PAD) {
      cells.push({
        pad, img: hqImage(house?.hq_level ?? 1), imgW: 198,
        onTap: () => setSheet({ pad, hq: true }),
        chip: house?.hq_upgrade
          ? <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-amber-500 text-black">🔨 {fmtLeft(house.hq_upgrade.done_at, now)}</span>
          : <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md" style={{ background: `${tint}cc`, color: '#fff' }}>Lv {house?.hq_level ?? 1}</span>,
      })
      continue
    }
    if (pad === (house?.print_shop_pad ?? PRINT_SHOP_PAD)) {
      const ready = (farm?.ready ?? 0) > 0
      cells.push({
        pad, img: '/house/print_shop.png', imgW: 128, movable: true,
        glow: ready, onTap: ready ? claimFarm : () => setSheet({ pad, ps: true }),
        chip: ready
          ? <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-amber-400 text-black animate-bounce">🧨 CLAIM {farm!.ready}</span>
          : farm ? <span className="text-[10px] font-bold px-1 rounded bg-black/45 text-gray-300">🧨 in {Math.max(1, Math.ceil((farm.next_in_secs ?? 0) / 60))}m</span> : undefined,
      })
      continue
    }
    const b = builtOn.get(pad)
    if (b) {
      const sp = SPRITES[b.type]
      const banked = b.type === 'media_tower' ? (house?.tower?.banked ?? 0) : 0
      const stored = b.type === 'safe' ? (house?.safe?.stored ?? 0) : 0
      const isFence = b.type === 'fence'
      const linked = isFence && fenceLinked(pad)
      cells.push({
        pad, movable: true,
        // linked fences show only the joint post (IsoFenceLinks draws the
        // panels); a lone fence keeps a small panel so it reads as a fence
        img: isFence ? (linked ? '/house/fence_post.png' : '/house/fence.png') : sp?.img(b.level),
        imgW: isFence ? (linked ? 13 : 76) : sp?.w,
        mirror: ((b.facing ?? 0) % 2) === 1,
        emoji: sp ? undefined : buildingDef(b.type)?.emoji,
        glow: banked > 0,
        onTap: () => setSheet({ pad, building: b }),
        chip: b.upgrade
          ? <span className="text-[10px] font-black px-1 rounded bg-amber-500 text-black">🔨 {fmtLeft(b.upgrade.done_at, now)}</span>
          : banked > 0
            ? <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md bg-emerald-400 text-black animate-bounce">+{banked} FP</span>
            : stored > 0
              ? <span className="text-[10px] font-black px-1 rounded bg-black/45 text-amber-300">🔐 {stored.toLocaleString()}</span>
              : <span className="text-[10px] font-bold px-1 rounded bg-black/45 text-gray-300">Lv {b.level}</span>,
      })
      continue
    }
    // empty plot — subtle diamond, tap to build
    cells.push({ pad, plot: true, onTap: () => setSheet({ pad }) })
  }

  const sparkles = SPARKLE_PADS.slice(0, house?.pickups ?? 0)

  // every empty cell is a legal landing spot (not the house, not occupied)
  const psPad = house?.print_shop_pad ?? PRINT_SHOP_PAD
  const validTargets = new Set<number>()
  for (let pad = 0; pad < GRID * GRID; pad++) {
    if (pad === HQ_PAD || pad === psPad || builtOn.has(pad)) continue
    validTargets.add(pad)
  }
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
        try { navigator.vibrate?.(12) } catch {}
        say(`🎖️ Trained! (-${d.spent} FP)`)
        load(); refetch()
      }
    } catch { say('❌ Could not train') } finally { setBusy(false) }
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
      else { try { navigator.vibrate?.(15) } catch {} }
    } catch { say('❌ Could not move') }
    load()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#0d1512] text-gray-200 select-none">
      {/* the yard stops above the bottom nav — the bar stays (Michael) */}
      <div className="absolute inset-x-0 top-0" style={{ bottom: '4.5rem' }}>
      <IsoYard cells={cells} bg="/house/yard_bg.png" validTargets={validTargets} movingFrom={moving}
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
              style={{ left: x, top: y - 46, zIndex: 900 }}>{p.text}</span>
          )
        })}
      </IsoYard>
      </div>

      {/* ── HUD: chrome at the edges, buttons clear of the bottom bar ── */}
      <div className="absolute top-3 left-3 z-[70] flex items-center gap-2">
        <button onClick={() => router.back()} className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center text-gray-200"><ArrowLeft size={17} /></button>
        <button onClick={toggleMusic} className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center text-gray-200">
          {music ? <Music size={15} /> : <VolumeX size={15} />}
        </button>
      </div>
      <div className="absolute top-3 right-3 z-[70] flex items-center gap-2">
        <span className="px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur text-amber-400 font-black text-sm">🏆 {house?.trophies ?? 0}</span>
        <span className="px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur text-yellow-400 font-black text-sm">⚡ {profile?.fp_balance?.toLocaleString() ?? 0}</span>
      </div>
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

      {/* build / manage sheet */}
      {sheet && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end" onClick={() => setSheet(null)}>
          <div className="w-full max-w-md mx-auto bg-gray-900 rounded-t-3xl border-t border-gray-700 p-5 max-h-[85vh] overflow-y-auto" style={{ paddingBottom: 'calc(2rem + 4.5rem + env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}>
            {sheet.hq ? (() => {
              const lvl = house?.hq_level ?? 1
              const cost = hqUpgradeCost(lvl)
              return (
                <>
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hqImage(lvl)} alt="" className="w-24 h-24 object-contain" />
                    <div>
                      <p className="text-white font-black text-lg">Your House <span className="text-gray-500 text-sm">Lv {lvl}</span></p>
                      <p className="text-gray-500 text-xs mt-1">{lvl >= HQ_MAX_LEVEL ? 'The crystal manor — as good as it gets.' : 'A better house defends your whole base.'}</p>
                    </div>
                  </div>
                  {house?.hq_upgrade ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between bg-gray-800/60 rounded-xl p-3 border border-amber-700/50">
                        <span className="text-amber-300 font-black text-sm">🔨 Upgrading to Lv {house.hq_upgrade.to}</span>
                        <span className="text-white font-black text-sm">{fmtLeft(house.hq_upgrade.done_at, now)}</span>
                      </div>
                      <button disabled={busy}
                        onClick={() => act({ action: 'rush', hq: true }, d => `⚡ Finished instantly! (-${d.spent} FP)`)}
                        className="mt-3 w-full py-3 rounded-xl font-black text-black disabled:opacity-35"
                        style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }}>
                        ⚡ FINISH NOW — {house.hq_upgrade.rush_cost.toLocaleString()} FP
                      </button>
                    </div>
                  ) : cost != null && (
                    <>
                      <div className="mt-4 flex items-center gap-3 bg-gray-800/60 rounded-xl p-3 border border-gray-700">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={hqImage(lvl + 1)} alt="" className="w-16 h-16 object-contain" />
                        <p className="text-gray-400 text-xs">Next: <span className="text-white font-bold">Level {lvl + 1}</span> — stronger defense, better looks</p>
                      </div>
                      <button disabled={busy}
                        onClick={() => act({ action: 'upgrade_hq' }, d => `🔨 Upgrade started! Done in ${Math.round(d.secs / 3600 * 10) / 10}h (-${d.spent} FP)`)}
                        className="mt-3 w-full py-3 rounded-xl font-black text-black disabled:opacity-35"
                        style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }}>
                        Upgrade to Lv {lvl + 1} — ⚡{cost.toLocaleString()}
                      </button>
                    </>
                  )}
                </>
              )
            })() : sheet.ps ? (
              <>
                <p className="text-white font-black text-lg">🧨 Print Shop</p>
                <p className="text-gray-500 text-xs mt-1">Cranks out pamphlet bundles on its own — come back and claim them.</p>
                <button onClick={() => { setMoving(sheet.pad); setSheet(null) }}
                  className="mt-3 w-full py-2.5 rounded-xl font-black text-white bg-gray-800 border border-gray-700 hover:border-gray-500">
                  📦 MOVE — pick a new spot
                </button>
              </>
            ) : sheet.building ? (() => {
              const def = buildingDef(sheet.building!.type)!
              const isTower = def.type === 'media_tower'
              const isSafe = def.type === 'safe'
              const maxLv = isTower ? TOWER_MAX_LEVEL : def.costs.length
              const nextCost = buildingCost(def.type, sheet.building!.level + 1)
              return (
                <>
                  <p className="text-white font-black text-lg">{def.emoji} {def.name} <span className="text-gray-500 text-sm">Lv {sheet.building!.level}</span></p>
                  <p className="text-gray-500 text-xs mt-1">{def.desc}</p>
                  <button onClick={() => { setMoving(sheet.pad); setSheet(null) }}
                    className="mt-3 w-full py-2.5 rounded-xl font-black text-white bg-gray-800 border border-gray-700 hover:border-gray-500">
                    📦 MOVE — pick a new spot, rotate while you're at it
                  </button>
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
                  {def.type === 'barracks' && (() => {
                    const lvl = sheet.building!.level
                    const roster = troopsForParty(profile?.party ?? 'republican')
                    const room = armyCap(lvl) - (army?.total ?? 0)
                    return (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-emerald-300">🎖️ Army {army?.total ?? 0}/{armyCap(lvl)}</span>
                          <span className="text-gray-500">raids hit +{army?.bonus ?? 0} harder</span>
                        </div>
                        <div className="mt-1.5 h-2.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(((army?.total ?? 0) / Math.max(1, armyCap(lvl))) * 100))}%`, background: 'linear-gradient(90deg,#34d399,#059669)' }} />
                        </div>
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
                                    <button disabled={busy || room < 1} onClick={() => train(tr.id, 1)}
                                      className="px-2.5 py-1.5 rounded-lg font-black text-black text-xs disabled:opacity-35"
                                      style={{ background: 'linear-gradient(135deg,#34d399,#059669)' }}>+1 ⚡{tr.cost}</button>
                                    <button disabled={busy || room < 5} onClick={() => train(tr.id, 5)}
                                      className="px-2.5 py-1 rounded-lg font-black text-white text-[10px] bg-gray-700 disabled:opacity-35">+5 ⚡{tr.cost * 5}</button>
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
                        <div className="flex items-center justify-between bg-gray-800/60 rounded-xl p-3 border border-amber-700/50">
                          <span className="text-amber-300 font-black text-sm">🔨 Upgrading to Lv {up.to}</span>
                          <span className="text-white font-black text-sm">{fmtLeft(up.done_at, now)}</span>
                        </div>
                        <button disabled={busy}
                          onClick={() => act({ action: 'rush', pad: sheet.pad }, d => `⚡ Finished instantly! (-${d.spent} FP)`)}
                          className="mt-3 w-full py-3 rounded-xl font-black text-black disabled:opacity-35"
                          style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }}>
                          ⚡ FINISH NOW — {up.rush_cost.toLocaleString()} FP
                        </button>
                      </div>
                    )
                    if (sheet.building!.level < maxLv && nextCost != null) return (
                      <button disabled={busy}
                        onClick={() => act({ action: 'upgrade', pad: sheet.pad }, d => `🔨 Upgrade started! Done in ${d.secs >= 3600 ? Math.round(d.secs / 360) / 10 + 'h' : Math.round(d.secs / 60) + 'm'} (-${d.spent} FP)`)}
                        className="mt-3 w-full py-3 rounded-xl font-black text-white bg-gray-800 border border-gray-700 hover:border-gray-500">
                        Upgrade to Lv {sheet.building!.level + 1} — ⚡{nextCost}
                      </button>
                    )
                    return null
                  })()}
                </>
              )
            })() : (
              <>
                <p className="text-white font-black text-lg">Build here</p>
                <div className="mt-3 space-y-2">
                  {Object.values(BUILDINGS).map(def => {
                    const blocked = def.unique && hasOf(def.type)
                    const thumb = SPRITES[def.type]?.img(1)
                    return (
                      <button key={def.type} disabled={busy || !!blocked}
                        onClick={() => act({ action: 'build', pad: sheet.pad, type: def.type }, d => `${def.emoji} ${def.name} built! (-${d.spent} FP)`)}
                        className="w-full bg-gray-800 rounded-xl border border-gray-700 p-3 flex items-center gap-3 hover:border-gray-500 disabled:opacity-40 text-left">
                        {thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={thumb} alt="" className="w-12 h-12 object-contain" />
                          : <span className="text-2xl">{def.emoji}</span>}
                        <span className="flex-1">
                          <span className="text-white font-bold text-sm block">{def.name}{blocked ? ' (already built)' : ''}</span>
                          <span className="text-gray-500 text-[11px]">{def.desc}</span>
                        </span>
                        <span className="text-yellow-400 font-black text-sm">⚡{def.costs[0]}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 z-[70] max-w-md w-[90%]" style={{ bottom: '8.5rem' }}>
          <div className="bg-gray-800/95 backdrop-blur text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
        </div>
      )}
    </div>
  )
}

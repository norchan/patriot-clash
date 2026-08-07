'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { GRID, HQ_PAD, PRINT_SHOP_PAD, buildingDef, hqImage, safeImage, barracksImage } from '@/config/house'
import { troopById } from '@/config/troops'
import IsoYard, { IsoCellSpec, isoPos, IsoFenceLinks, fenceAdjacency, STAGE_W, STAGE_H } from '@/components/IsoYard'

// ⚔️ RAID — same isometric stage as the home base. The server settles
// damage/loot/trophies/casualties the moment you launch; everything after is
// choreography over decided numbers. The choreography is a CoC-LITE ASSAULT
// (Grok's brief, 2026-08-04 round 2 — the old one-sprite slideshow "records a
// result"): several of your trained troops deploy at the yard edge, WALK to
// the outermost fences, ATTACK IN PLACE over multiple hits, and only then does
// the target fall and its loot share pop. A requestAnimationFrame engine
// drives troop sprites imperatively (no per-frame React renders, no
// CSS-transition first-paint races); React only hears about discrete events —
// deaths, loot, sparks. Skip fast-forwards to the settled result.

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

// ── assault tuning (timing rationale in the channel entry) ──
const WALK_SPEED = 210        // logical px/s — brisk march, still reads as walking
const HIT_SECS = 0.38         // one swing every ~0.4s
const HITS_FENCE = 2          // fences crack after two swings
const HITS_BUILDING = 3       // buildings soak three
const MAX_TROOPS = 6          // concurrent attackers on screen
const SPAWN_STAGGER = 0.38    // secs between deploys
const TROOP_W = 84

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

interface AssaultTarget { pad: number; x: number; y: number; hp: number; dead: boolean }
interface Trooper {
  el: HTMLImageElement
  x: number; y: number
  state: 'wait' | 'walk' | 'attack' | 'gone'
  activeAt: number          // engine clock when this troop deploys
  t: number                 // seconds in current state
  target: number            // index into targets, -1 = none
  lastHitAt: number         // whole swings already landed
}

export default function RaidPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [phase, setPhase] = useState<PhaseT>('finding')
  const [found, setFound] = useState<Found | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [smashed, setSmashed] = useState<Set<number>>(new Set())
  const [lootShown, setLootShown] = useState(0)
  const [floats, setFloats] = useState<Array<{ id: number; pad: number; text: string; spark?: boolean; jx?: number }>>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const floatId = useRef(0)
  const layerRef = useRef<HTMLDivElement>(null)     // imperative troop sprites live here
  const engineRef = useRef<{ raf: number; alive: boolean } | null>(null)
  const assaultRan = useRef(false)

  const isRep = (p?: string) => p === 'republican'

  function stopEngine() {
    if (engineRef.current) {
      engineRef.current.alive = false
      cancelAnimationFrame(engineRef.current.raf)
      engineRef.current = null
    }
    if (layerRef.current) layerRef.current.innerHTML = ''
  }

  async function findTarget() {
    stopEngine(); assaultRan.current = false
    setPhase('finding'); setErr(''); setResult(null); setSmashed(new Set()); setLootShown(0)
    try {
      const res = await fetch('/api/house/raid')
      const d = await res.json()
      if (!res.ok) { setErr(d.message ?? d.error ?? 'No targets found'); return }
      setFound(d); setPhase('preview')
    } catch { setErr('Network error') }
  }
  useEffect(() => { findTarget() }, [])
  useEffect(() => () => stopEngine(), [])

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

  function addFloat(pad: number, text: string, spark = false, life = 900) {
    const id = ++floatId.current
    setFloats(f => [...f, { id, pad, text, spark, jx: spark ? Math.random() * 30 - 15 : 0 }])
    setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), life)
  }

  // ── THE ASSAULT ENGINE ─────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'smash' || !result || assaultRan.current) return
    assaultRan.current = true
    const layer = layerRef.current
    if (!layer) return

    // targets: OUTERMOST fences first (attackers come from outside the wall),
    // then everything else by depth — the same smashable set as before
    const cx0 = STAGE_W / 2, cy0 = 210 + (GRID - 1) * 46 // yard center-ish
    const distC = (pad: number) => { const p = isoPos(pad); return Math.hypot(p.x - cx0, p.y - cy0) }
    const fences = result.base.buildings.filter(b => b.type === 'fence')
      .sort((a, b) => distC(b.pad) - distC(a.pad))
    const others = result.base.buildings.filter(b => b.type !== 'fence')
      .sort((a, b) => isoPos(a.pad).depth - isoPos(b.pad).depth)
    const targets: AssaultTarget[] = [...fences, ...others].map(b => ({
      pad: b.pad, x: isoPos(b.pad).x, y: isoPos(b.pad).y,
      hp: b.type === 'fence' || b.type === 'decor' ? HITS_FENCE : HITS_BUILDING,
      dead: false,
    }))
    if (!targets.length) { setLootShown(result.loot); setPhase('done'); return }
    const lootPer = Math.floor(result.loot / targets.length)
    let lootGiven = 0
    let targetsLeft = targets.length

    // deploy squad: real marched sprites, 3..6 on screen, staggered entries
    const marchedIds = (result.army?.marched ?? []).flatMap(m => Array(Math.min(m.n, 4)).fill(m.id))
    if (!marchedIds.length) marchedIds.push(isRep(profile?.party) ? 'rep_minuteman' : 'dem_picket_captain')
    const squadN = Math.min(MAX_TROOPS, Math.max(3, marchedIds.length), targets.length)

    let cursor = 0
    const takeTarget = (): number => {
      while (cursor < targets.length && targets[cursor].dead) cursor++
      return cursor < targets.length ? cursor++ : -1
    }

    const spawnPoint = (tg: AssaultTarget) => {
      // out past the target, away from the yard center — troops walk IN
      const dx = tg.x - cx0, dy = tg.y - cy0
      const len = Math.max(1, Math.hypot(dx, dy))
      return {
        x: Math.max(-40, Math.min(STAGE_W + 40, tg.x + (dx / len) * 330)),
        y: Math.max(60, Math.min(STAGE_H + 40, tg.y + (dy / len) * 330 + 60)),
      }
    }

    const troops: Trooper[] = []
    for (let i = 0; i < squadN; i++) {
      const ti = takeTarget()
      if (ti < 0) break
      const tg = targets[ti]
      const sp = spawnPoint(tg)
      const el = document.createElement('img')
      el.src = troopById(marchedIds[i % marchedIds.length])?.img ?? '/troops/rep_minuteman.png'
      el.draggable = false
      Object.assign(el.style, {
        position: 'absolute', width: `${TROOP_W}px`, maxWidth: 'none',
        left: '0px', top: '0px', zIndex: '1400', pointerEvents: 'none',
        filter: 'drop-shadow(0 8px 10px rgba(0,0,0,0.45))',
        opacity: '0', transition: 'opacity .25s',
      })
      layer.appendChild(el)
      troops.push({ el, x: sp.x, y: sp.y, state: 'wait', activeAt: i * SPAWN_STAGGER, t: 0, target: ti, lastHitAt: 0 })
    }

    const paint = (tr: Trooper, lungeX = 0, lungeY = 0) => {
      const tg = tr.target >= 0 ? targets[tr.target] : null
      const flip = tg ? tg.x < tr.x : false
      tr.el.style.left = `${tr.x + lungeX}px`
      tr.el.style.top = `${tr.y + lungeY}px`
      tr.el.style.transform = `translate(-50%, -100%)${flip ? ' scaleX(-1)' : ''}`
    }

    const killTarget = (ti: number) => {
      const tg = targets[ti]
      tg.dead = true
      targetsLeft--
      const chunk = targetsLeft === 0 ? result.loot - lootGiven : lootPer
      lootGiven += chunk
      setSmashed(prev => { const n = new Set(prev); n.add(tg.pad); return n })
      setLootShown(v => v + chunk)
      addFloat(tg.pad, chunk > 0 ? `+${chunk} FP` : '💥')
      pop(150 + Math.random() * 100); buzz(30)
    }

    const engine = { raf: 0, alive: true }
    engineRef.current = engine
    let last = performance.now()
    let clock = 0
    const tick = (now: number) => {
      if (!engine.alive) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      clock += dt

      let anyBusy = false
      for (const tr of troops) {
        if (tr.state === 'gone') continue
        if (tr.state === 'wait') {
          if (clock >= tr.activeAt) { tr.state = 'walk'; tr.el.style.opacity = '1'; paint(tr) }
          anyBusy = true
          continue
        }
        // a squadmate may have finished this target — pick the next one
        if (tr.target < 0 || targets[tr.target].dead) {
          const ti = takeTarget()
          if (ti < 0) { tr.state = 'gone'; tr.el.style.opacity = '0'; continue }
          tr.target = ti; tr.state = 'walk'
        }
        const tg = targets[tr.target]
        if (tr.state === 'walk') {
          const dx = tg.x - tr.x, dy = (tg.y + 6) - tr.y
          const d = Math.hypot(dx, dy)
          if (d <= 30) { tr.state = 'attack'; tr.t = 0; tr.lastHitAt = 0 }
          else {
            const step = Math.min(d, WALK_SPEED * dt)
            tr.x += (dx / d) * step
            tr.y += (dy / d) * step
            // light march-bob so the walk reads as walking, not sliding
            paint(tr, 0, Math.sin(clock * 14) * 2.5)
          }
          anyBusy = true
        } else if (tr.state === 'attack') {
          tr.t += dt
          // lunge toward the target on every swing
          const dx = tg.x - tr.x, dy = tg.y - tr.y
          const d = Math.max(1, Math.hypot(dx, dy))
          const s = Math.max(0, Math.sin((tr.t % HIT_SECS) / HIT_SECS * Math.PI))
          paint(tr, (dx / d) * s * 13, (dy / d) * s * 13)
          const hitsDue = Math.floor(tr.t / HIT_SECS)
          if (hitsDue > tr.lastHitAt) {
            tr.lastHitAt = hitsDue
            tg.hp -= 1
            addFloat(tg.pad, '💥', true, 420)
            pop(320 + Math.random() * 160); buzz(12)
            if (tg.hp <= 0) killTarget(tr.target)
          }
          anyBusy = true
        }
      }

      if (targetsLeft <= 0) {
        engine.alive = false
        for (const tr of troops) tr.el.style.opacity = '0'
        setLootShown(result.loot) // snap over rounding dust
        setTimeout(() => { if (assaultRan.current) { stopEngine(); setPhase('done') } }, 750)
        return
      }
      if (!anyBusy) { // safety net: nobody active but targets remain — force-finish
        engine.alive = false
        setSmashed(new Set(result.base.buildings.map(b => b.pad)))
        setLootShown(result.loot)
        setTimeout(() => setPhase('done'), 400)
        return
      }
      engine.raf = requestAnimationFrame(tick)
    }
    engine.raf = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result])

  function skipAssault() {
    if (!result) return
    stopEngine()
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
        imgW: isFence ? (linked ? 14 : 76) : sp?.w,
        mirror: ((b.facing ?? 0) % 2) === 1,
        emoji: dead ? '💥' : (sp ? undefined : buildingDef(b.type)?.emoji ?? '🏗️'),
        dead,
        chip: !dead && b.type !== 'decor' && b.type !== 'fence'
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
          {/* the assault engine paints troop sprites into this layer */}
          <div ref={layerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 1400 }} />
          {floats.map(f => {
            const { x, y } = isoPos(f.pad)
            return f.spark ? (
              <span key={f.id} className="absolute pointer-events-none -translate-x-1/2"
                style={{ left: x + (f.jx ?? 0), top: y - 42, zIndex: 1600, fontSize: 15 }}>💥</span>
            ) : (
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

      {phase === 'smash' && result && (
        <>
          {/* during the fight: just the loot ticker — the full report waits */}
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[70] bg-black/60 backdrop-blur rounded-2xl px-4 py-2">
            <span className="text-yellow-300 font-black text-lg">⚡ +{lootShown}</span>
          </div>
          <div style={{ bottom: '5.5rem' }} className="absolute left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3">
            <span className="px-3 py-2 rounded-xl bg-black/60 backdrop-blur text-gray-200 text-xs font-bold animate-pulse">
              ⚔️ Your army is attacking {result.defender.username}'s base…
            </span>
            <button onClick={skipAssault}
              className="px-3 py-2 rounded-xl bg-black/40 text-gray-500 text-xs font-bold">skip →</button>
          </div>
        </>
      )}

      {phase === 'done' && result && (
        <>
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-4 bg-black/60 backdrop-blur rounded-2xl px-4 py-2">
            <span className="text-yellow-300 font-black text-lg">⚡ +{lootShown}</span>
            <span className="text-gray-300 font-bold text-xs">{result.damage_pct}% damage</span>
            <span className="text-amber-400 font-black text-xs">🏆 +{result.trophies}</span>
          </div>
          {(result.army?.losses?.length ?? 0) > 0 && (
            <div className="absolute top-[6.5rem] left-1/2 -translate-x-1/2 z-[70] bg-black/60 backdrop-blur rounded-xl px-3 py-1.5 text-[11px] font-bold text-red-300 whitespace-nowrap">
              Fallen: {result.army!.losses.map(l => `${l.emoji} ${l.n} ${l.name}`).join(' · ')}
            </div>
          )}
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
        </>
      )}
    </div>
  )
}

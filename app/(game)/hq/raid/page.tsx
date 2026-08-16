'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { GRID, HQ_PAD, PRINT_SHOP_PAD, buildingDef, hqImage, safeImage, barracksImage, solarImage, turretImage } from '@/config/house'
import { troopById } from '@/config/troops'
import IsoYard, { IsoCellSpec, isoPos, IsoFenceLinks, fenceAdjacency, STAGE_W, STAGE_H, ORIGIN_Y, TILE_H } from '@/components/IsoYard'
import { IdleFxItem } from '@/components/BaseIdleFx'

// ⚔️ RAID — same isometric stage as the home base. The server settles
// damage/loot/trophies/casualties the moment you launch; everything after is
// choreography over decided numbers. The choreography is CoC-STYLE DEPLOY
// (Michael via Grok, 2026-08-06: "the player taps where to release troops"):
// after launch you get the enemy base and a TROOP TRAY — tap a troop type,
// then tap the yard to drop one there. Dropped troops head for the nearest
// BUILDING, breaching only fences that block the straight path (Grok
// 2026-08-08 — walls are obstacles, not targets; splash troops are the
// wall-breaker exception), attack in place over multiple swings, and only
// then does the target fall and its loot share pop. Deploy more while they
// fight. AUTO dribbles the rest in near buildings; skip fast-forwards to the
// settled result. The fight ends when the buildings are down — an untouched
// wall ring stays standing.

interface TargetBase { baseLevel: number; padsOpen: number; buildings: Array<{ pad: number; type: string; level: number; facing?: number; damaged?: boolean }>; print_shop_pad?: number }
interface Target { id: string; username: string; party: string; level: number; base_level: number; base: TargetBase }
interface Found { target: Target; cost: number; loot_min: number; loot_max: number; army?: { total: number; power: number; bonus: number } }
interface Result {
  damage_pct: number; loot: number; trophies: number; base: TargetBase
  defender: { username: string; party: string }
  army?: { bonus: number; marched?: Array<{ id: string; n: number }>; losses: Array<{ id: string; n: number; name: string; emoji: string }> }
}

type PhaseT = 'finding' | 'preview' | 'deploy' | 'done'

const SPRITES: Record<string, { img: (level: number) => string; w: number }> = {
  fence: { img: () => '/house/fence.png', w: 118 },
  media_tower: { img: () => '/house/media_tower.webp', w: 126 },
  safe: { img: l => safeImage(l), w: 96 },
  barracks: { img: l => barracksImage(l), w: 150 },
  solar: { img: l => solarImage(l), w: 134 },
  doberman: { img: () => '/house/doberman.webp', w: 104 },
  turret: { img: l => turretImage(l), w: 118 },
  decor: { img: () => '/house/decor_flag.webp', w: 84 },
  print_shop: { img: () => '/house/print_shop.webp', w: 128 },
}

// ── assault tuning (rationale in the channel entry) ──
const WALK_SPEED = 200        // logical px/s
const HIT_SECS = 0.4          // one swing every 0.4s
const HITS_FENCE = 3          // even fences take three swings
const HITS_BUILDING = 4       // buildings take four
const FIELD_CAP = 16          // max troops on the field at once
const AUTO_EVERY = 0.55       // AUTO deploy cadence, secs
const TROOP_W = 84
// path-blocker geometry (Grok 2026-08-08: buildings first, breach only what
// blocks the way): a living fence within this perpendicular distance of the
// straight line to the goal building counts as blocking
const BLOCK_PERP = 46
// ── CoC-style animation (Michael 2026-08-09: "it should appear that they are
// running... animations for when they are attacking... health bars") ──
const RUN_ORDER = ['run1', 'run3', 'run2'] as const   // 3-beat stride cycle
const RUN_FRAME_SECS = 0.12
const TROOP_H = 92            // flipbook frames render by height (side profile)
const RETURN_HIT_SECS = 0.85  // defenders punch back while a troop fights
// THE DOBERMAN (Michael 2026-08-09): the defender's guard dog. Never dies —
// his health wears down and he RUNS OFF SCREEN, back at full strength next
// raid. Faster than any troop; his bite is the visible face of return damage.
const DOG_SPEED = 260
const DOG_BITE_SECS = 0.85
const DOG_BITE_DMG = 13       // extra hp the victim loses per bite
const DOG_WEAR = 9            // hp the dog loses per bite exchange
const DOG_H = 74
// GUARD TOWERS (Michael 2026-08-10): living turrets fire on troops in range.
const TURRET_RANGE = 330
const TURRET_SHOT_SECS = [1.8, 1.5, 1.2]   // per level, faster guns up top
const TURRET_DMG = [7, 10, 13]             // troop hp per hit, per level
const frameSrc = (id: string, f: string) => `/troops/anim/${id}_${f}.png`

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

interface AssaultTarget { pad: number; x: number; y: number; hp: number; maxHp: number; dead: boolean; isFence: boolean }
interface Trooper {
  root: HTMLDivElement      // positioned group: sprite + hp bar
  img: HTMLImageElement
  barFill: HTMLDivElement
  x: number; y: number
  type: string              // troop id — splash roles play wall-breaker
  state: 'walk' | 'attack' | 'gone' | 'dead'
  t: number
  goal: number              // the BUILDING this troop is working toward
  target: number            // what it's actually swinging at (goal, or a blocking fence)
  lastHitAt: number
  hp: number                // 0..100, drained by defender return hits
  retT: number              // time since last return hit
  animT: number             // run-cycle clock
  curFrame: string
}

export default function RaidPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [phase, setPhase] = useState<PhaseT>('finding')
  const [found, setFound] = useState<Found | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [smashed, setSmashed] = useState<Set<number>>(new Set())
  const [lootShown, setLootShown] = useState(0)
  const [floats, setFloats] = useState<Array<{ id: number; pad?: number; sx?: number; sy?: number; text: string; spark?: boolean; jx?: number }>>([])
  const [tray, setTray] = useState<Record<string, number>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const floatId = useRef(0)
  const layerRef = useRef<HTMLDivElement>(null)     // imperative troop sprites live here
  const engineRef = useRef<{ raf: number; alive: boolean } | null>(null)
  const engineStarted = useRef(false)
  const trayRef = useRef<Record<string, number>>({})
  const statsRef = useRef({ fences: 0, buildings: 0 })
  const [hitPad, setHitPad] = useState<number | null>(null)
  // pad → hp fraction (0..1) for the building HP bars; absent = untouched
  const [dmg, setDmg] = useState<Record<number, number>>({})
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoRef = useRef(false)
  const deployRef = useRef<((type: string, x: number, y: number) => void) | null>(null)

  const isRep = (p?: string) => p === 'republican'

  function stopEngine() {
    if (engineRef.current) {
      engineRef.current.alive = false
      cancelAnimationFrame(engineRef.current.raf)
      engineRef.current = null
    }
    deployRef.current = null
    if (layerRef.current) layerRef.current.innerHTML = ''
  }

  async function findTarget() {
    stopEngine(); engineStarted.current = false
    statsRef.current = { fences: 0, buildings: 0 }
    setPhase('finding'); setErr(''); setResult(null); setSmashed(new Set()); setLootShown(0)
    setDmg({}); setTray({}); setSel(null); setAuto(false); autoRef.current = false
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
      const d: Result = await res.json()
      if (!res.ok) { setErr((d as any).message ?? (d as any).error ?? 'Raid failed'); return }
      // the tray is the marched army — what you tap is what attacks
      const t: Record<string, number> = {}
      for (const m of d.army?.marched ?? []) t[m.id] = m.n
      trayRef.current = { ...t }
      setTray(t)
      setSel(Object.keys(t).find(k => t[k] > 0) ?? null)
      setResult(d); setPhase('deploy'); buzz(40)
      refetch()
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  function addFloat(f: { pad?: number; sx?: number; sy?: number; text: string; spark?: boolean }, life = 900) {
    const id = ++floatId.current
    setFloats(fl => [...fl, { id, jx: f.spark ? Math.random() * 30 - 15 : 0, ...f }])
    setTimeout(() => setFloats(fl => fl.filter(x => x.id !== id)), life)
  }

  // ── THE DEPLOY ENGINE — player taps feed it; it just animates the fight.
  // TARGETING (Grok 2026-08-08): troops go for BUILDINGS. A fence is attacked
  // only when it sits on the straight line to the chosen building — breach,
  // then continue to the SAME goal. Splash troops are the exception: they
  // play wall-breaker and prefer fences. Focus fire pulls 2-3 troops onto a
  // building already under attack. The fight ends when the BUILDINGS are
  // down — an untouched wall ring stays standing. ──
  useEffect(() => {
    if (phase !== 'deploy' || !result || engineStarted.current) return
    engineStarted.current = true
    const layer = layerRef.current
    if (!layer) return

    const targets: AssaultTarget[] = result.base.buildings
      .filter(b => b.type !== 'doberman' && !b.damaged)  // the dog can't be attacked; rubble is pre-broken
      .map(b => {
      const hp = b.type === 'fence' || b.type === 'decor' ? HITS_FENCE : HITS_BUILDING
      return {
        pad: b.pad, x: isoPos(b.pad).x, y: isoPos(b.pad).y,
        hp, maxHp: hp,
        dead: false,
        isFence: b.type === 'fence',
      }
    })
    if (!targets.length) { setLootShown(result.loot); setPhase('done'); return }
    // loot rides on BUILDINGS — walls are obstacles, not piñatas. A base that
    // is ONLY fences (rare, human-built) falls back to fences carrying it.
    const buildingIdxs = targets.map((t, i) => i).filter(i => !targets[i].isFence)
    const fenceOnlyBase = buildingIdxs.length === 0
    const goalPool = fenceOnlyBase ? targets.map((_, i) => i) : buildingIdxs
    let goalsLeft = goalPool.length
    const lootPer = Math.floor(result.loot / goalPool.length)
    let lootGiven = 0
    const troops: Trooper[] = []

    const dist = (i: number, x: number, y: number) => Math.hypot(targets[i].x - x, targets[i].y - y)
    const attackersOn = (gi: number) => troops.reduce((s, t) => s + (t.state !== 'gone' && t.goal === gi ? 1 : 0), 0)

    const chooseGoal = (tr: Trooper): number => {
      // wall-breaker flavor: splash troops (Pyro Patriot / Drum Circle) hunt walls
      if (troopById(tr.type)?.role === 'splash') {
        let bf = -1, bfd = Infinity
        for (let i = 0; i < targets.length; i++) {
          if (targets[i].dead || !targets[i].isFence) continue
          const d = dist(i, tr.x, tr.y)
          if (d < bfd) { bfd = d; bf = i }
        }
        if (bf >= 0) return bf
      }
      let best = -1, bd = Infinity
      for (const i of goalPool) {
        if (targets[i].dead) continue
        let d = dist(i, tr.x, tr.y)
        // focus fire: join a building 1-2 squadmates already hit — capped so
        // the whole squad doesn't clump on one target
        const a = attackersOn(i)
        if (a >= 1 && a < 3 && d < 300) d *= 0.55
        if (d < bd) { bd = d; best = i }
      }
      return best
    }

    // first living fence sitting ON the straight line from (x,y) to the goal
    const blockerOn = (x: number, y: number, gi: number): number => {
      const g = targets[gi]
      const dx = g.x - x, dy = g.y - y
      const len = Math.hypot(dx, dy)
      if (len < 40) return -1
      let best = -1, bestT = Infinity
      for (let i = 0; i < targets.length; i++) {
        const f = targets[i]
        if (f.dead || !f.isFence) continue
        const t = ((f.x - x) * dx + (f.y - y) * dy) / (len * len)
        if (t < 0.04 || t > 0.96) continue
        const perp = Math.abs((f.x - x) * dy - (f.y - y) * dx) / len
        if (perp > BLOCK_PERP) continue
        if (t < bestT) { bestT = t; best = i }
      }
      return best
    }

    // goal first, then: breach whatever blocks the path, else hit the goal
    const pickTarget = (tr: Trooper) => {
      if (tr.goal < 0 || targets[tr.goal].dead) tr.goal = chooseGoal(tr)
      if (tr.goal < 0) { tr.target = -1; return }
      const blk = targets[tr.goal].isFence ? -1 : blockerOn(tr.x, tr.y, tr.goal)
      tr.target = blk >= 0 ? blk : tr.goal
      tr.state = 'walk'
    }

    const hitFlash = (pad: number) => {
      setHitPad(pad)
      if (hitTimer.current) clearTimeout(hitTimer.current)
      hitTimer.current = setTimeout(() => setHitPad(null), 260)
    }

    const killTarget = (ti: number) => {
      const tg = targets[ti]
      tg.dead = true
      setDmg(prev => { const n = { ...prev }; delete n[tg.pad]; return n })
      const carriesLoot = fenceOnlyBase || !tg.isFence
      let chunk = 0
      if (carriesLoot) {
        goalsLeft--
        chunk = goalsLeft === 0 ? result.loot - lootGiven : lootPer
        lootGiven += chunk
      }
      if (tg.isFence) statsRef.current.fences++
      else statsRef.current.buildings++
      setSmashed(prev => { const n = new Set(prev); n.add(tg.pad); return n })
      if (chunk > 0) setLootShown(v => v + chunk)
      addFloat({ pad: tg.pad, text: chunk > 0 ? `+${chunk} FP` : '💥' })
      pop(150 + Math.random() * 100); buzz(30)
    }

    const paint = (tr: Trooper, lungeX = 0, lungeY = 0) => {
      const tg = tr.target >= 0 ? targets[tr.target] : null
      const flip = tg ? tg.x < tr.x : false
      tr.root.style.left = `${tr.x + lungeX}px`
      tr.root.style.top = `${tr.y + lungeY}px`
      tr.img.style.transform = `translate(-50%, -100%)${flip ? ' scaleX(-1)' : ''}`
    }

    // ── flipbooks: preload every marched type's frames once; a type whose
    // frames are missing falls back to its static portrait (no cycling) ──
    const staticIds = new Set<string>()
    for (const id of Object.keys(trayRef.current)) {
      for (const f of ['run1', 'run2', 'run3', 'atk1', 'atk2']) {
        const im = new Image()
        im.onerror = () => staticIds.add(id)
        im.src = frameSrc(id, f)
      }
    }
    // deaths in the theater are CAPPED at the server's settled casualties —
    // the fight can only look as bloody as it actually was
    const deathBudget = (result.army?.losses ?? []).reduce((sum, l) => sum + l.n, 0)
    let deathsUsed = 0

    const hurtTroop = (tr: Trooper, amount: number): boolean => {
      tr.hp -= amount
      updateBar(tr)
      tr.img.style.filter = 'drop-shadow(0 8px 10px rgba(0,0,0,0.45)) brightness(1.5) saturate(2)'
      setTimeout(() => { tr.img.style.filter = 'drop-shadow(0 8px 10px rgba(0,0,0,0.45))' }, 110)
      if (tr.hp <= 0) {
        if (deathsUsed < deathBudget) { deathsUsed++; dieTroop(tr); return true }
        tr.hp = 8 // out of scripted casualties — this one grits its teeth
        updateBar(tr)
      }
      return false
    }

    // ── the guard dog ──
    const dogRow = result.base.buildings.find(b => b.type === 'doberman' && !b.damaged)
    interface Dog {
      root: HTMLDivElement; img: HTMLImageElement; barFill: HTMLDivElement
      x: number; y: number; hp: number
      state: 'idle' | 'chase' | 'bite' | 'flee' | 'gone'
      victim: Trooper | null; biteT: number; animT: number; curFrame: string
      dustT: number
    }
    let dog: Dog | null = null
    const dogFrames = { available: true }
    if (dogRow) {
      const at = isoPos(dogRow.pad)
      const root = document.createElement('div')
      Object.assign(root.style, { position: 'absolute', left: '0px', top: '0px', zIndex: '1450', pointerEvents: 'none', transition: 'opacity .3s' })
      const img = document.createElement('img')
      // he STARTS as the exact building-sprite art at the exact pad spot, so
      // the yard-cell → live-actor handoff is invisible; switching to run
      // frames then reads as the dog GETTING UP (Michael 2026-08-13)
      img.src = '/house/doberman.webp'
      const probe = new Image()
      probe.onerror = () => { dogFrames.available = false }
      probe.src = frameSrc('doberman', 'run1')
      img.draggable = false
      Object.assign(img.style, {
        // sized like the yard cell (width 104, statue pose) until he moves
        position: 'absolute', width: '104px', height: 'auto', maxWidth: 'none', left: '0px', top: '0px',
        transform: 'translate(-50%, -100%)',
        filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.45))',
      })
      const bar = document.createElement('div')
      Object.assign(bar.style, {
        position: 'absolute', left: '-20px', top: '-' + String(DOG_H + 12) + 'px',
        width: '40px', height: '5px', background: 'rgba(0,0,0,0.55)',
        border: '1px solid rgba(0,0,0,0.45)', borderRadius: '3px', overflow: 'hidden',
        opacity: '0', transition: 'opacity .25s', // hidden until he takes wear, like building chips
      })
      const barFill = document.createElement('div')
      Object.assign(barFill.style, { height: '100%', width: '100%', background: '#4ade80', transition: 'width .18s' })
      bar.appendChild(barFill)
      root.appendChild(img); root.appendChild(bar)
      layer.appendChild(root)
      dog = { root, img, barFill, x: at.x, y: at.y, hp: 100, state: 'idle', victim: null, biteT: 0, animT: 0, curFrame: 'sit', dustT: 0 }
      root.style.left = String(at.x) + 'px'
      root.style.top = String(at.y) + 'px'
    }
    // ── the turret battery: every LIVING turret tracks and fires. A smashed
    // or pre-damaged turret goes silent — raiders can shoot the guns first. ──
    interface Turret { pad: number; x: number; y: number; level: number; cd: number }
    const turrets: Turret[] = result.base.buildings
      .filter(b => b.type === 'turret' && !b.damaged)
      .map(b => {
        const at = isoPos(b.pad)
        return { pad: b.pad, x: at.x, y: at.y - 46, level: Math.max(1, Math.min(3, b.level)), cd: 0.6 + Math.random() * 1.2 }
      })
    const targetByPad = new Map(targets.map((t, i) => [t.pad, i]))
    const fireTracer = (fx: number, fy: number, tx: number, ty: number) => {
      const tr = document.createElement('div')
      const ang = Math.atan2(ty - fy, tx - fx) * 180 / Math.PI
      Object.assign(tr.style, {
        position: 'absolute', left: String(fx) + 'px', top: String(fy) + 'px',
        width: '16px', height: '3px', background: '#fde047', borderRadius: '2px',
        boxShadow: '0 0 6px #fde047', zIndex: '1440', pointerEvents: 'none',
        transform: 'rotate(' + ang + 'deg)',
        transition: 'left 0.13s linear, top 0.13s linear',
      })
      layer.appendChild(tr)
      requestAnimationFrame(() => { tr.style.left = String(tx) + 'px'; tr.style.top = String(ty) + 'px' })
      setTimeout(() => tr.remove(), 200)
    }

    const paintDog = (lx = 0, ly = 0) => {
      if (!dog) return
      const flip = dog.victim ? dog.victim.x < dog.x : (dog.state === 'flee' && dog.x < STAGE_W / 2)
      dog.root.style.left = String(dog.x + lx) + 'px'
      dog.root.style.top = String(dog.y + ly) + 'px'
      dog.img.style.transform = 'translate(-50%, -100%)' + (flip ? ' scaleX(-1)' : '')
    }

    const updateBar = (tr: Trooper) => {
      const pct = Math.max(0, Math.min(100, tr.hp))
      tr.barFill.style.width = `${pct}%`
      tr.barFill.style.background = pct > 50 ? '#4ade80' : pct > 25 ? '#fbbf24' : '#ef4444'
    }
    const dieTroop = (tr: Trooper) => {
      tr.state = 'dead'
      tr.root.style.opacity = '0'
      addFloat({ sx: tr.x, sy: tr.y - 44, text: '💀', spark: true }, 700)
      pop(120); buzz(25)
      setTimeout(() => tr.root.remove(), 400)
    }

    // the player's tap lands here (and AUTO uses it too)
    deployRef.current = (type: string, x: number, y: number) => {
      if ((trayRef.current[type] ?? 0) <= 0) return
      if (troops.filter(t => t.state === 'walk' || t.state === 'attack').length >= FIELD_CAP) { buzz(20); return }
      trayRef.current[type]--
      setTray({ ...trayRef.current })
      const root = document.createElement('div')
      Object.assign(root.style, {
        position: 'absolute', left: '0px', top: '0px', zIndex: '1400',
        pointerEvents: 'none', opacity: '0', transition: 'opacity .2s',
      })
      const img = document.createElement('img')
      const isStatic = staticIds.has(type)
      img.src = isStatic ? (troopById(type)?.img ?? '/troops/rep_minuteman.png') : frameSrc(type, 'run1')
      img.onerror = () => { staticIds.add(type); img.src = troopById(type)?.img ?? '/troops/rep_minuteman.png' }
      img.draggable = false
      Object.assign(img.style, {
        position: 'absolute', height: `${TROOP_H}px`, maxWidth: 'none',
        left: '0px', top: '0px',
        transform: 'translate(-50%, -100%)',
        filter: 'drop-shadow(0 8px 10px rgba(0,0,0,0.45))',
      })
      // CoC-style hp pip above the sprite
      const bar = document.createElement('div')
      Object.assign(bar.style, {
        position: 'absolute', left: '-22px', top: `-${TROOP_H + 12}px`,
        width: '44px', height: '5px', background: 'rgba(0,0,0,0.55)',
        border: '1px solid rgba(0,0,0,0.45)', borderRadius: '3px', overflow: 'hidden',
      })
      const barFill = document.createElement('div')
      Object.assign(barFill.style, { height: '100%', width: '100%', background: '#4ade80', transition: 'width .18s' })
      bar.appendChild(barFill)
      root.appendChild(img)
      root.appendChild(bar)
      layer.appendChild(root)
      requestAnimationFrame(() => { root.style.opacity = '1' })
      const tr: Trooper = {
        root, img, barFill, x, y, type, state: 'walk', t: 0, goal: -1, target: -1,
        lastHitAt: 0, hp: 100, retT: 0, animT: Math.random(), curFrame: 'run1',
      }
      pickTarget(tr)
      paint(tr)
      troops.push(tr)
      addFloat({ sx: x, sy: y - 20, text: '⬇️', spark: true }, 500)
      pop(500); buzz(15)
    }

    const engine = { raf: 0, alive: true }
    engineRef.current = engine
    let last = performance.now()
    let clock = 0
    let lastAuto = 0
    const tick = (now: number) => {
      if (!engine.alive) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      clock += dt

      // AUTO: dribble the tray in at the edge nearest LIVING BUILDINGS —
      // never optimized for fence farming
      if (autoRef.current && clock - lastAuto >= AUTO_EVERY) {
        const type = Object.keys(trayRef.current).sort((a, b) => (trayRef.current[b] ?? 0) - (trayRef.current[a] ?? 0))[0]
        if (type && (trayRef.current[type] ?? 0) > 0) {
          const living = goalPool.filter(i => !targets[i].dead).map(i => targets[i])
          if (living.length) {
            lastAuto = clock
            const tg = living[Math.floor(Math.random() * living.length)]
            const cx0 = STAGE_W / 2, cy0 = ORIGIN_Y + (GRID - 1) * (TILE_H / 2)
            const dx = tg.x - cx0, dy = tg.y - cy0
            const len = Math.max(1, Math.hypot(dx, dy))
            deployRef.current?.(type,
              Math.max(-40, Math.min(STAGE_W + 40, tg.x + (dx / len) * 300)),
              Math.max(60, Math.min(STAGE_H + 40, tg.y + (dy / len) * 300 + 50)))
          }
        }
      }

      for (const tr of troops) {
        if (tr.state === 'gone' || tr.state === 'dead') continue
        // target dead (a squadmate finished it) or goal gone → re-path.
        // The goal is KEPT while alive: after a breach the troop resumes
        // toward the same building, never "next fence anywhere".
        if (tr.target < 0 || targets[tr.target].dead || tr.goal < 0 || targets[tr.goal].dead) {
          pickTarget(tr)
          if (tr.target < 0) { tr.state = 'gone'; tr.root.style.opacity = '0'; continue }
        }
        const tg = targets[tr.target]
        // ── flipbook: stride cycle while running, windup→strike while fighting ──
        tr.animT += dt
        if (!staticIds.has(tr.type)) {
          const f = tr.state === 'walk'
            ? RUN_ORDER[Math.floor(tr.animT / RUN_FRAME_SECS) % RUN_ORDER.length]
            : ((tr.t % HIT_SECS) / HIT_SECS < 0.55 ? 'atk1' : 'atk2')
          if (f !== tr.curFrame) { tr.curFrame = f; tr.img.src = frameSrc(tr.type, f) }
        }
        if (tr.state === 'walk') {
          const dx = tg.x - tr.x, dy = (tg.y + 6) - tr.y
          const d = Math.hypot(dx, dy)
          if (d <= 30) { tr.state = 'attack'; tr.t = 0; tr.lastHitAt = 0; tr.retT = 0 }
          else {
            const step = Math.min(d, WALK_SPEED * dt)
            tr.x += (dx / d) * step
            tr.y += (dy / d) * step
            paint(tr, 0, Math.sin(clock * 14) * 2.5)  // march-bob
          }
        } else if (tr.state === 'attack') {
          tr.t += dt
          const dx = tg.x - tr.x, dy = tg.y - tr.y
          const d = Math.max(1, Math.hypot(dx, dy))
          const sw = Math.max(0, Math.sin((tr.t % HIT_SECS) / HIT_SECS * Math.PI))
          paint(tr, (dx / d) * sw * 13, (dy / d) * sw * 13)
          const hitsDue = Math.floor(tr.t / HIT_SECS)
          if (hitsDue > tr.lastHitAt) {
            tr.lastHitAt = hitsDue
            if (!tg.dead) {
              tg.hp -= 1
              setDmg(prev => ({ ...prev, [tg.pad]: Math.max(0, tg.hp) / tg.maxHp }))
              addFloat({ pad: tg.pad, text: '💥', spark: true }, 420)
              hitFlash(tg.pad)
              pop(320 + Math.random() * 160); buzz(12)
              if (tg.hp <= 0) killTarget(tr.target)
            }
          }
          // ── defenders punch back: hp drains while fighting; when it empties
          // a troop FALLS — but never more than the server's casualty count ──
          tr.retT += dt
          if (tr.retT >= RETURN_HIT_SECS) {
            tr.retT = 0
            if (hurtTroop(tr, 9 + Math.random() * 9)) continue
          }
        }
      }

      // army spent with buildings still standing → the raid winds down (the
      // loot was settled at launch; the theater just ran out of soldiers)
      const fieldAlive = troops.some(t => t.state === 'walk' || t.state === 'attack')
      const trayLeft = Object.values(trayRef.current).reduce((sm, n) => sm + n, 0)
      if (!fieldAlive && troops.length > 0 && trayLeft === 0 && goalsLeft > 0) {
        engine.alive = false
        setLootShown(result.loot)
        setTimeout(() => { stopEngine(); setPhase('done') }, 900)
        return
      }

      // ── the turret battery fires ──
      for (const tu of turrets) {
        const ti = targetByPad.get(tu.pad)
        if (ti != null && targets[ti].dead) continue  // smashed — silenced
        tu.cd -= dt
        if (tu.cd > 0) continue
        const living = troops.filter(t => (t.state === 'walk' || t.state === 'attack')
          && Math.hypot(t.x - tu.x, t.y - (tu.y + 46)) <= TURRET_RANGE)
        if (!living.length) { tu.cd = 0.25; continue }
        tu.cd = TURRET_SHOT_SECS[tu.level - 1]
        const v = living[Math.floor(Math.random() * living.length)]
        fireTracer(tu.x, tu.y, v.x, v.y - 40)
        pop(700 + Math.random() * 200); buzz(8)
        const victim = v
        setTimeout(() => {
          if (victim.state === 'walk' || victim.state === 'attack') {
            addFloat({ sx: victim.x, sy: victim.y - 52, text: '💥', spark: true }, 380)
            hurtTroop(victim, TURRET_DMG[tu.level - 1])
          }
        }, 140)
      }

      // ── the dog does his rounds ──
      if (dog && dog.state !== 'gone') {
        dog.animT += dt
        if (dogFrames.available) {
          const f = dog.state === 'bite'
            ? (dog.biteT % DOG_BITE_SECS < DOG_BITE_SECS / 2 ? 'atk1' : 'atk2')
            : dog.state === 'idle' ? 'sit'
            : RUN_ORDER[Math.floor(dog.animT / 0.1) % RUN_ORDER.length]
          if (f !== dog.curFrame) {
            dog.curFrame = f
            if (f === 'sit') { // at his post he IS the yard statue, same art + size
              dog.img.src = '/house/doberman.webp'
              dog.img.style.width = '104px'; dog.img.style.height = 'auto'
            } else {
              dog.img.src = frameSrc('doberman', f)
              dog.img.style.width = 'auto'; dog.img.style.height = String(DOG_H) + 'px'
            }
          }
        }
        const living = troops.filter(t => t.state === 'walk' || t.state === 'attack')
        if (dog.state === 'flee') {
          const edgeX = dog.x < STAGE_W / 2 ? -90 : STAGE_W + 90
          dog.x += (edgeX < dog.x ? -1 : 1) * DOG_SPEED * 1.2 * dt
          paintDog(0, Math.sin(clock * 16) * 3)
          if (dog.x < -80 || dog.x > STAGE_W + 80) { dog.state = 'gone'; dog.root.style.opacity = '0' }
        } else if (!living.length) {
          dog.state = 'idle'
          dog.victim = null
          paintDog(0, Math.sin(clock * 2.2) * 1.5)   // alert sway at his post
        } else {
          if (!dog.victim || dog.victim.state === 'dead' || dog.victim.state === 'gone') {
            let best: Trooper | null = null, bd = Infinity
            for (const t of living) {
              const d = Math.hypot(t.x - dog.x, t.y - dog.y)
              if (d < bd) { bd = d; best = t }
            }
            // waking from his post → a bark beat before the sprint, so the
            // statue visibly BECOMES the attacker (Michael 2026-08-13)
            if (dog.state === 'idle') {
              addFloat({ sx: dog.x, sy: dog.y - 60, text: '❗', spark: true }, 500)
              pop(880); buzz(20)
            }
            dog.victim = best
            dog.state = 'chase'
          }
          const v = dog.victim!
          const d = Math.hypot(v.x - dog.x, v.y - dog.y)
          if (dog.state === 'chase') {
            if (d <= 34) { dog.state = 'bite'; dog.biteT = 0 }
            else {
              dog.x += ((v.x - dog.x) / Math.max(1, d)) * DOG_SPEED * dt
              dog.y += ((v.y - dog.y) / Math.max(1, d)) * DOG_SPEED * dt
              paintDog(0, Math.sin(clock * 16) * 3)  // gallop bob
              // dust kicked up at his heels while sprinting
              dog.dustT += dt
              if (dog.dustT >= 0.22) {
                dog.dustT = 0
                addFloat({ sx: dog.x - ((v.x - dog.x) / Math.max(1, d)) * 26, sy: dog.y - 8, text: '💨', spark: true }, 350)
              }
            }
          } else if (dog.state === 'bite') {
            if (d > 60) { dog.state = 'chase' }  // victim moved on
            else {
              dog.biteT += dt
              const lunge = Math.max(0, Math.sin((dog.biteT % DOG_BITE_SECS) / DOG_BITE_SECS * Math.PI))
              paintDog(((v.x - dog.x) / Math.max(1, d)) * lunge * 10, ((v.y - dog.y) / Math.max(1, d)) * lunge * 10)
              if (dog.biteT >= DOG_BITE_SECS) {
                dog.biteT = 0
                addFloat({ sx: v.x, sy: v.y - 50, text: '🦷', spark: true }, 420)
                pop(600); buzz(14)
                hurtTroop(v, DOG_BITE_DMG)
                // they fight back — the dog wears down, then RUNS (never dies)
                dog.hp -= DOG_WEAR
                const pct = Math.max(0, dog.hp)
                ;(dog.barFill.parentElement as HTMLDivElement).style.opacity = '1'
                dog.barFill.style.width = String(pct) + '%'
                dog.barFill.style.background = pct > 50 ? '#4ade80' : pct > 25 ? '#fbbf24' : '#ef4444'
                if (dog.hp <= 0) {
                  dog.state = 'flee'
                  dog.victim = null
                  addFloat({ sx: dog.x, sy: dog.y - 44, text: '💨', spark: true }, 600)
                }
              }
            }
          }
        }
      }

      // the fight is over when the BUILDINGS are down — walls left standing
      // stay standing (a closed ring is breached, not mopped)
      if (goalsLeft <= 0) {
        engine.alive = false
        for (const tr of troops) tr.root.style.opacity = '0'
        setLootShown(result.loot) // snap over rounding dust
        setTimeout(() => { stopEngine(); setPhase('done') }, 750)
        return
      }
      engine.raf = requestAnimationFrame(tick)
    }
    engine.raf = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result])

  function handleStageTap(x: number, y: number) {
    if (phase !== 'deploy' || !sel) return
    if (x < -40 || x > STAGE_W + 40 || y < 40 || y > STAGE_H + 40) return
    deployRef.current?.(sel, x, y)
    // auto-advance selection when the stack runs dry
    if ((trayRef.current[sel] ?? 0) <= 0) {
      setSel(Object.keys(trayRef.current).find(k => (trayRef.current[k] ?? 0) > 0) ?? null)
    }
  }

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
  const fencePads = new Set((base?.buildings ?? []).filter(b => b.type === 'fence' && !smashed.has(b.pad) && !b.damaged).map(b => b.pad))
  const fenceLinkedSet = fenceAdjacency(fencePads).linked
  if (base) {
    const onPad = new Map(base.buildings.map(b => [b.pad, b]))
    for (let pad = 0; pad < GRID * GRID; pad++) {
      if (pad === HQ_PAD) { cells.push({ pad, img: hqImage(base.baseLevel), imgW: 198 }); continue }
      if (pad === PRINT_SHOP_PAD) { cells.push({ pad, img: '/house/print_shop.webp', imgW: 128 }); continue }
      const b = onPad.get(pad)
      if (!b) { cells.push({ pad, plot: true }); continue }
      // during the assault the dog is a LIVE ACTOR in the troop layer — the
      // yard must not also draw him as a building, or you get a statue that
      // a "ghost dog" runs out of (Michael 2026-08-13). He starts as the
      // same art at the same spot, so hiding this cell is invisible; the
      // statue returns on 'done' (he never dies — back at his post).
      if (b.type === 'doberman' && phase === 'deploy') { cells.push({ pad, plot: true }); continue }
      const sp = SPRITES[b.type]
      const dead = smashed.has(pad) || (!!b.damaged && b.type !== 'doberman')
      const isFence = b.type === 'fence'
      const linked = isFence && fenceLinkedSet.has(pad)
      cells.push({
        pad,
        // BUILDINGS keep their sprite when smashed — the stage chars them
        // (art bible §7); a downed FENCE vanishes to a 💥 (it's breached,
        // a standing burned panel would read as still blocking)
        img: dead && isFence ? undefined : (isFence ? (linked ? '/house/fence_post.png' : '/house/fence.png') : sp?.img(b.level)),
        imgW: isFence ? (linked ? 14 : 76) : sp?.w,
        mirror: ((b.facing ?? 0) % 2) === 1,
        emoji: dead && isFence ? '💥' : (sp ? undefined : buildingDef(b.type)?.emoji ?? '🏗️'),
        // B3: enemy flags flap, the guard dog shifts — the preview isn't a postcard
        idle: b.type === 'decor' ? 'sway' : b.type === 'doberman' ? 'dog' : undefined,
        dead,
        jiggle: pad === hitPad,
        chip: !dead && dmg[pad] != null && dmg[pad] < 1
          ? (
            <span className="block rounded-sm overflow-hidden shadow-lg" style={{ width: 48, height: 7, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(0,0,0,0.5)' }}>
              <span className="block h-full" style={{ width: `${Math.round(dmg[pad] * 100)}%`, background: dmg[pad] > 0.5 ? '#4ade80' : dmg[pad] > 0.25 ? '#fbbf24' : '#ef4444', transition: 'width .18s' }} />
            </span>
          )
          : !dead && b.type !== 'decor' && b.type !== 'fence'
            ? <span className="text-[12px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-gray-200 shadow-lg">Lv {b.level}</span>
            : undefined,
      })
    }
  }

  const trayEntries = Object.entries(tray)
  const trayTotal = trayEntries.reduce((s, [, n]) => s + n, 0)

  // B3 idle life on the PREVIEW only — once troops deploy, the fight owns
  // the stage (flag sway + dog idle stay on, they're sprite-level)
  const idleFx: IdleFxItem[] = []
  if (base && phase === 'preview') {
    idleFx.push({ pad: HQ_PAD, kind: 'glow', dy: 66 })
    idleFx.push({ pad: base.print_shop_pad ?? 15, kind: 'smoke', dx: 20, dy: 112 })
    for (const b of base.buildings) {
      if (b.damaged) continue
      if (b.type === 'media_tower') idleFx.push({ pad: b.pad, kind: 'ping', dy: 146 })
      if (b.type === 'solar') idleFx.push({ pad: b.pad, kind: 'glint', dy: 46 })
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#150f0d] text-gray-200 select-none">
      {base && (
        <div className="absolute inset-x-0 top-0" style={{ bottom: '4.5rem' }}>
        <IsoYard cells={cells} bg="/house/yard_bg2.webp" idleFx={idleFx}
          onStageTap={phase === 'deploy' ? handleStageTap : undefined}>
          <IsoFenceLinks fencePads={fencePads} />
          {/* the deploy engine paints troop sprites into this layer */}
          <div ref={layerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 1400 }} />
          {floats.map(f => {
            const p = f.pad != null ? isoPos(f.pad) : { x: f.sx ?? 0, y: f.sy ?? 0 }
            return f.spark ? (
              <span key={f.id} className="absolute pointer-events-none -translate-x-1/2"
                style={{ left: p.x + (f.jx ?? 0), top: p.y - 42, zIndex: 1600, fontSize: 15 }}>{f.text}</span>
            ) : (
              <span key={f.id} className="absolute text-yellow-300 font-black text-base animate-bounce pointer-events-none -translate-x-1/2"
                style={{ left: p.x, top: p.y - 56, zIndex: 1600 }}>{f.text}</span>
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

      {phase === 'deploy' && result && (
        <>
          {/* fight HUD: loot ticker only — the report waits for the end */}
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[70] bg-black/60 backdrop-blur rounded-2xl px-4 py-2">
            <span className="text-yellow-300 font-black text-lg">⚡ +{lootShown}</span>
          </div>
          {/* TROOP TRAY — pick a troop, tap the yard to release */}
          <div style={{ bottom: '5rem' }} className="absolute inset-x-0 z-[70] flex flex-col items-center gap-1.5 px-2">
            <span className="px-3 py-1 rounded-lg bg-black/60 backdrop-blur text-gray-300 text-[11px] font-bold">
              {trayTotal > 0 ? '👇 Tap the yard to release troops' : 'All troops deployed!'}
            </span>
            <div className="flex items-end gap-1.5 max-w-full overflow-x-auto px-1 py-1">
              {trayEntries.map(([id, n]) => {
                const def = troopById(id)
                const active = sel === id
                return (
                  <button key={id} onClick={() => setSel(id)} disabled={n <= 0}
                    className={`relative shrink-0 rounded-xl border-2 p-1 bg-black/60 backdrop-blur transition
                      ${active ? 'border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.5)]' : 'border-gray-700'}
                      ${n <= 0 ? 'opacity-35 grayscale' : 'active:scale-95'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={def?.img} alt={def?.name ?? id} className="w-12 h-12 object-contain" />
                    <span className={`absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-black flex items-center justify-center
                      ${active ? 'bg-amber-400 text-black' : 'bg-gray-800 text-gray-200 border border-gray-600'}`}>{n}</span>
                  </button>
                )
              })}
              <button onClick={() => { autoRef.current = !autoRef.current; setAuto(autoRef.current) }}
                className={`shrink-0 px-3 h-12 rounded-xl border-2 font-black text-xs backdrop-blur transition
                  ${auto ? 'border-emerald-400 bg-emerald-950/70 text-emerald-300' : 'border-gray-700 bg-black/60 text-gray-400'}`}>
                AUTO
              </button>
              <button onClick={skipAssault}
                className="shrink-0 px-3 h-12 rounded-xl border-2 border-gray-700 bg-black/40 text-gray-500 text-xs font-bold">
                skip →
              </button>
            </div>
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
          {(statsRef.current.fences > 0 || statsRef.current.buildings > 0) && (
            <div className="absolute top-[9rem] left-1/2 -translate-x-1/2 z-[70] bg-black/60 backdrop-blur rounded-xl px-3 py-1.5 text-[11px] font-bold text-gray-300 whitespace-nowrap">
              {statsRef.current.fences > 0 ? `🧱 Breached ${statsRef.current.fences} wall segment${statsRef.current.fences === 1 ? '' : 's'} · ` : ''}🏚️ Destroyed {statsRef.current.buildings} building{statsRef.current.buildings === 1 ? '' : 's'}
            </div>
          )}
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

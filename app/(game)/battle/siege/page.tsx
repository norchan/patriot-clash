'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { useLocation } from '@/hooks/useLocation'
import { sfx, buzz, siegeMusic } from '@/lib/juice'
import { fighterLevel } from '@/lib/fighter'
import { SIEGE_ATTACKS, ATTACKS_FOR_PARTY, type SiegeAttackId } from '@/config/siege-attacks'

// Siege Mode: attacking a town hall plays out over the fortified-hall
// scene. The server stays fully authoritative twice over:
//  - /api/gyms/[id]/challenge is called ONCE per 100 FP assault and rolls
//    total damage + capture; swipes (rocks) and taps (troops) spend that
//    damage budget interactively.
//  - the three party special buttons call /api/gyms/[id]/strike, which
//    spends FP and rolls bonus damage server-side; the animations here
//    just dramatize the number it returns.

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

interface Projectile {
  id: number
  x0: number; y0: number
  x1: number; y1: number
  kind: 'rock' | 'firecracker'
  launched: boolean
}

interface Soldier {
  id: number
  kind: 'troop' | 'poor'
  x: number; y: number     // current position (%)
  tx: number; ty: number   // fight position at the walls (%)
  flip: boolean            // mirror the sprite to face the travel direction
  state: 'march' | 'fight' | 'poof'
  spawnedAt: number
  lastHit: number
  hits: number
  maxHits: number
}

interface Spark { id: number; x: number; y: number; text: string; color: string }

// One special-effect sprite: mounts at (x0,y0)%, glides to (x1,y1)%.
interface Fx {
  id: number
  src?: string          // image sprite
  src2?: string         // second frame — flaps between src/src2
  emoji?: string
  boom?: boolean        // static pop-in explosion instead of flight
  x0: number; y0: number
  x1: number; y1: number
  size: number          // px height (img) or font size (emoji)
  dur: number
  spin?: boolean
  flip?: boolean
  easeIn?: boolean
}

const MARCH_MS = 1100          // soldier travel time to the walls
const SOLDIER_HIT_MS = 850     // time between soldier strikes
const THROW_MS = 420           // projectile flight time
const THROW_COOLDOWN_MS = 320
const ASSAULT_MAX_MS = 12000   // hard cap: an assault lasts at most 12 seconds

// The hall sits dead center of the base map; attacks aim here
const HALL_X = 50
const HALL_Y = 47

// Corner defense turrets (screen %). Every tick they may pick off a troop —
// the closer he is to a turret, the deadlier. The free troops are capped, and the
// defenses terminate some of them: WHERE you drop them is the skill.
// Ring of towers around the central keep (matches the base art) — troops
// charging the center must run this gauntlet
const DEFENSE_GUNS = [
  { x: 50, y: 33 },
  { x: 33, y: 43 }, { x: 67, y: 43 },
  { x: 33, y: 55 }, { x: 67, y: 55 },
  { x: 50, y: 62 },
]
const KILL_BASE = { march: 0.022, fight: 0.028 } // per 200ms tick

const TROOP_RUN = ['/halls/soldier_run1.png', '/halls/soldier_run3.png', '/halls/soldier_run2.png']
const TROOP_ATK = ['/halls/soldier_atk1.png', '/halls/soldier_atk3.png', '/halls/soldier_atk2.png']
// Free ground game per 100 FP assault (siege rework A2) — no unlimited spam;
// pressure beyond this comes from owned gear and party specials
const FREE_TROOPS = 5
const POOR_RUN = ['/siege/poor_run1.png', '/siege/poor_run2.png']
const POOR_ATK = ['/siege/poor_atk.png']

// N-frame flipbook: stacked images alternating opacity via keyframes
function Flipbook({ frames, cycleMs }: { frames: string[]; cycleMs: number }) {
  const n = frames.length
  return (
    <>
      {frames.map((src, fi) => (
        <img key={src + fi} src={src} alt="" draggable={false} style={{
          position: 'absolute', bottom: 0, left: '50%',
          height: '100%', width: 'auto', maxWidth: 'none',
          transform: 'translateX(-50%)',
          animation: n > 1 ? `sgF${n}_${fi} ${cycleMs}ms steps(1) infinite` : undefined,
        }} />
      ))}
    </>
  )
}

function FxItem({ f }: { f: Fx }) {
  const [fly, setFly] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setFly(true)))
    return () => cancelAnimationFrame(raf)
  }, [])
  const inner = f.boom ? (
    <span style={{ fontSize: f.size, animation: 'sgBoom 0.75s ease-out forwards' }}>{f.emoji ?? '💥'}</span>
  ) : f.src ? (
    <span className="block relative" style={{ height: f.size, width: f.size * 1.2 }}>
      {f.src2 ? (
        <>
          <img src={f.src} alt="" style={{ position: 'absolute', inset: 0, height: '100%', width: '100%', objectFit: 'contain', animation: 'sgF2_0 240ms steps(1) infinite' }} />
          <img src={f.src2} alt="" style={{ position: 'absolute', inset: 0, height: '100%', width: '100%', objectFit: 'contain', animation: 'sgF2_1 240ms steps(1) infinite' }} />
        </>
      ) : (
        <img src={f.src} alt="" style={{ height: '100%', width: '100%', objectFit: 'contain', animation: f.spin ? `sgSpin ${f.dur}ms linear` : undefined }} />
      )}
    </span>
  ) : (
    <span style={{ fontSize: f.size, display: 'block', animation: f.spin ? `sgSpin ${f.dur}ms linear` : undefined }}>{f.emoji}</span>
  )
  return (
    <div className="absolute z-20 pointer-events-none" style={{
      left: `${fly && !f.boom ? f.x1 : f.x0}%`,
      top: `${fly && !f.boom ? f.y1 : f.y0}%`,
      transition: f.boom ? undefined : `left ${f.dur}ms ${f.easeIn ? 'ease-in' : 'ease-out'}, top ${f.dur}ms ${f.easeIn ? 'ease-in' : 'ease-out'}`,
      transform: `translate(-50%, -50%)${f.flip ? ' scaleX(-1)' : ''}`,
      filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.55))',
    }}>{inner}</div>
  )
}

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

  const [defense, setDefense] = useState(0)
  const [maxDefense, setMaxDefense] = useState(1)
  const [shaking, setShaking] = useState(false)
  const [bigShake, setBigShake] = useState(false)
  const [banner, setBanner] = useState('')
  const [projectiles, setProjectiles] = useState<Projectile[]>([])
  const [soldiers, setSoldiers] = useState<Soldier[]>([])
  const [sparks, setSparks] = useState<Spark[]>([])
  const [fx, setFx] = useState<Fx[]>([])
  const [shockwaves, setShockwaves] = useState<{ id: number; x: number; y: number }[]>([])
  const [strikeBusy, setStrikeBusy] = useState(false)
  const [boostBusy, setBoostBusy] = useState(false)
  const [result, setResult] = useState<{ captured: boolean; damage: number; remaining: number } | null>(null)
  // owned siege gear (firecracker/dynamite/rocket) for the in-assault tray
  const [inv, setInv] = useState<Record<string, number>>({})
  const [troopsLeft, setTroopsLeft] = useState(FREE_TROOPS)
  const [powerFlash, setPowerFlash] = useState<number | null>(null)

  // Party ground game (siege rework A1): Democrats field Canvassers,
  // Republicans field Marshals — same troops, party-true names
  const troopName = profile?.party === 'republican' ? 'Marshals' : 'Canvassers'

  // Higher-level attackers field deadlier, hardier troops
  const playerLevel = fighterLevel(profile?.total_battles_won ?? 0)
  const troopPower = 1 + Math.min(1.5, (playerLevel - 1) * 0.12)  // +12%/level, cap +150%
  const troopMaxHits = 4 + Math.min(6, Math.floor(playerLevel / 2)) // survive more turret shots

  const idRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const soldiersRef = useRef<Soldier[]>([])
  // Special-strike damage pool: server-approved damage that the animation
  // chips off the bar in pieces
  const strikePool = useRef({ pending: 0, target: 0, chunk: 0 })
  // Assault bookkeeping lives in refs — pointer handlers and intervals
  // must read live values, not render-time snapshots
  const S = useRef({
    budget: 0,         // total defense points this assault removes
    dealt: 0,
    captured: false,
    damage: 0,
    remaining: 0,      // authoritative defense after everything lands
    throwCount: 0,
    lastThrow: 0,
    troopsUsed: 0,     // free units are CAPPED per assault (siege rework A2)
    ended: false,
  })

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); siegeMusic.stop() }, [])

  useEffect(() => {
    if (!gymId) return
    fetch(`/api/gyms/${gymId}`)
      .then(r => r.json())
      .then(d => {
        if (d.gym) {
          setGym(d.gym)
          setDefense(d.gym.defense_points)
          setMaxDefense(Math.max(d.gym.defense_points, 1))
          setPhase('ready')
        }
      })
      .catch(() => {})
  }, [gymId])

  const holderColor = gym?.holder_party === 'democrat' ? '#2563eb' : gym?.holder_party === 'republican' ? '#dc2626' : '#9ca3af'
  const myColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const samePartyHall = !!gym?.holder_party && gym.holder_party === profile?.party
  const myAttacks = ATTACKS_FOR_PARTY(profile?.party === 'democrat' ? 'democrat' : 'republican')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  function schedule(ms: number, fn: () => void) {
    timersRef.current.push(setTimeout(fn, ms))
  }

  function addSpark(xPct: number, yPct: number, text: string, color: string) {
    const id = ++idRef.current
    setSparks(s => [...s, { id, x: xPct, y: yPct, text, color }])
    schedule(850, () => setSparks(s => s.filter(sp => sp.id !== id)))
  }

  function addFx(f: Omit<Fx, 'id'>, removeAfter: number) {
    const id = ++idRef.current
    setFx(prev => [...prev, { ...f, id }])
    schedule(removeAfter, () => setFx(prev => prev.filter(x => x.id !== id)))
  }

  function shakeScreen(big = false) {
    if (big) {
      setBigShake(true)
      schedule(500, () => setBigShake(false))
    } else {
      setShaking(true)
      schedule(240, () => setShaking(false))
    }
  }

  // ── Assault damage: every hit spends part of the challenge's budget ──────
  function applyDamage(chunk: number, xPct: number, yPct: number) {
    const st = S.current
    if (st.ended || phase !== 'assault') return
    const applied = Math.round(Math.min(st.budget - st.dealt, chunk))
    if (applied <= 0) return
    st.dealt += applied
    setDefense(prev => {
      const next = Math.max(0, prev - applied)
      // Captured hall drained to zero → end the fight immediately
      if (next <= 0 && st.captured && !st.ended) finishAssault()
      return next
    })
    addSpark(xPct, yPct, `-${applied.toLocaleString()}`, '#facc15')
    shakeScreen()
    sfx.siegeBlow()
    buzz(30)
    if (st.dealt >= st.budget - 0.5) finishAssault()
  }

  // ── Strike damage: chips the server-approved special-attack roll ─────────
  function chipStrike(chunk: number, xPct: number, yPct: number) {
    const pool = strikePool.current
    if (pool.pending <= 0) return
    const d = Math.round(Math.min(chunk, pool.pending))
    if (d <= 0) return
    pool.pending -= d
    setDefense(prev => Math.max(pool.target, prev - d))
    addSpark(xPct, yPct, `-${d.toLocaleString()}`, '#fbbf24')
    shakeScreen()
    sfx.siegeBlow()
    buzz(35)
  }

  function finishAssault() {
    const st = S.current
    if (st.ended) return
    st.ended = true
    siegeMusic.stop()
    setDefense(st.captured ? 0 : Math.max(1, st.remaining))
    schedule(500, () => {
      setBanner(st.captured ? 'CAPTURED!' : 'DEFENSE HOLDS')
      if (st.captured) sfx.capture()
      else sfx.defeat()
    })
    schedule(2300, () => {
      setBanner('')
      soldiersRef.current = []
      setSoldiers([])
      setProjectiles([])
      setFx([])
      setResult({ captured: st.captured, damage: st.damage, remaining: st.remaining })
      setPhase('result')
      setBusy(false)
    })
  }

  // ── Begin: one authoritative API call, then the interactive assault ──────
  async function beginAssault() {
    if (!gym || busy) return
    if (!location) {
      showToast('📍 Still finding your location — make sure location access is allowed')
      return
    }
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
      const st = S.current
      st.captured = !!data.captured
      st.damage = data.damage ?? 0
      st.remaining = data.defense_remaining ?? 0
      st.budget = Math.max(1, st.captured ? defense : st.damage)
      st.dealt = 0
      st.throwCount = 0
      st.troopsUsed = 0
      st.ended = false
      setTroopsLeft(FREE_TROOPS)
      setPhase('assault')
      setBanner('ASSAULT!')
      // Honest power reveal (siege rework A3): flash the server's exact roll
      // so nobody thinks free troops "almost took" a hall the roll capped
      setPowerFlash(Math.round(st.budget))
      schedule(2200, () => setPowerFlash(null))
      sfx.bell(true)
      siegeMusic.start()
      schedule(800, () => setBanner(''))
      // Hard 12s cap — whatever's left of the budget lands and the fight ends
      schedule(ASSAULT_MAX_MS, () => { if (!S.current.ended) finishAssault() })
    } catch {
      showToast('❌ Attack failed')
      setBusy(false)
    }
  }

  // ── Party special strikes: server spends FP + rolls damage, we perform ───
  async function strike(attackId: SiegeAttackId) {
    const st = S.current
    if (!gym || strikeBusy || st.ended || st.captured) return
    if (!location) { showToast('📍 Still finding your location...'); return }
    const def = SIEGE_ATTACKS[attackId]
    if ((profile?.fp_balance ?? 0) < def.fp) { showToast(`❌ Need ${def.fp} FP for ${def.name}`); return }
    setStrikeBusy(true)
    try {
      const res = await fetch(`/api/gyms/${gym.id}/strike`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attack: attackId, latitude: location.lat, longitude: location.lng }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`❌ ${data.message || data.error || 'Strike failed'}`)
        setStrikeBusy(false)
        return
      }
      refetch()
      st.remaining = data.defense_remaining
      const total = playStrike(attackId, data.damage)
      schedule(total, () => {
        strikePool.current.pending = 0
        setDefense(prev => Math.min(prev, Math.max(1, data.defense_remaining)))
        setStrikeBusy(false)
      })
    } catch {
      showToast('❌ Strike failed')
      setStrikeBusy(false)
    }
  }

  // ── Siege gear (rework B1-B3): owned consumables, spent server-side ──────
  // Load the bag when the screen opens (GET also claims the daily freebie)
  useEffect(() => {
    fetch('/api/items').then(r => r.json())
      .then(d => { if (d.items) setInv(d.items) })
      .catch(() => {})
  }, [])

  async function useGear(item: 'firecracker' | 'dynamite' | 'rocket') {
    const st = S.current
    if (!gym || boostBusy || st.ended || st.captured) return
    if (!location) { showToast('📍 Still finding your location...'); return }
    if ((inv[item] ?? 0) <= 0) return
    setBoostBusy(true)
    try {
      const res = await fetch(`/api/gyms/${gym.id}/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, latitude: location.lat, longitude: location.lng }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(`❌ ${data.message || data.error || 'Gear failed'}`)
        setBoostBusy(false)
        return
      }
      setInv(v => ({ ...v, [item]: Math.max(0, (v[item] ?? 0) - 1) }))
      st.remaining = data.defense_remaining
      // gear damage is REAL hall damage on top of the assault budget —
      // dramatize the server's number
      const x = HALL_X - 6 + Math.random() * 12, y = HALL_Y - 4 + Math.random() * 8
      addFx({ boom: true, emoji: item === 'rocket' ? '🚀💥' : item === 'dynamite' ? '💣💥' : '🧨💥', x0: x, y0: y, x1: x, y1: y, size: item === 'rocket' ? 64 : 48, dur: 750 }, 800)
      addSpark(x, y - 6, `-${data.damage.toLocaleString()}`, '#fbbf24')
      const id = ++idRef.current
      setShockwaves(w => [...w, { id, x, y }])
      schedule(900, () => setShockwaves(w => w.filter(s => s.id !== id)))
      setDefense(data.defense_remaining)
      sfx.siegeBlow()
      buzz(40)
      // Option 1 capture rule (brief non-goal preserved): gear can NEVER
      // finish a hall — be honest about the floor
      if (data.defense_remaining <= 1) {
        showToast('🛡️ Defenses can\'t fall below 1 — win an assault to capture!')
      }
    } catch {
      showToast('❌ Gear failed')
    }
    setBoostBusy(false)
  }

  // Choreography per attack — returns total duration ms
  function playStrike(attackId: SiegeAttackId, damage: number): number {
    const pool = strikePool.current
    pool.pending = damage
    pool.target = Math.max(1, defense - damage)
    sfx.bell(false)

    if (attackId === 'tired') {
      // volley of pitchforks raining onto the hall
      const n = 9
      pool.chunk = damage / n
      for (let i = 0; i < n; i++) {
        const x1 = 35 + Math.random() * 30
        const y1 = 38 + Math.random() * 12
        schedule(i * 100, () => {
          addFx({ src: '/siege/pitchfork.png', x0: 8 + Math.random() * 84, y0: 106, x1, y1, size: 54, dur: 650, spin: true, easeIn: true }, 700)
          schedule(650, () => chipStrike(pool.chunk, x1, y1 - 4))
        })
      }
      return n * 100 + 900
    }

    if (attackId === 'poor') {
      // a furious mob storms the gates
      const n = 7
      pool.chunk = damage / (n * 3)
      for (let i = 0; i < n; i++) {
        schedule(i * 130, () => {
          const sx = 6 + Math.random() * 88
          const tx = HALL_X - 10 + Math.random() * 20
          const soldier: Soldier = {
            id: ++idRef.current,
            kind: 'poor',
            x: sx, y: 100,
            tx, ty: HALL_Y + 4 + Math.random() * 8,
            flip: tx < sx,
            state: 'march',
            spawnedAt: Date.now(),
            lastHit: 0,
            hits: 0,
            maxHits: 3,
          }
          soldiersRef.current = [...soldiersRef.current, soldier]
          setSoldiers(soldiersRef.current)
        })
      }
      return 5600
    }

    if (attackId === 'free') {
      // the huddled masses charge in a cloud of smoke
      for (let i = 0; i < 6; i++) {
        schedule(i * 120, () => {
          addFx({ emoji: '💨', x0: 20 + Math.random() * 60, y0: 100, x1: 30 + Math.random() * 40, y1: 42 + Math.random() * 16, size: 64 + Math.random() * 40, dur: 1400 }, 1900)
        })
      }
      schedule(200, () => {
        addFx({ src: '/siege/crowd.png', x0: 50, y0: 96, x1: 50, y1: 56, size: 240, dur: 1500 }, 2600)
      })
      const chunks = 4
      pool.chunk = damage / chunks
      for (let i = 0; i < chunks; i++) {
        schedule(1500 + i * 220, () => {
          chipStrike(pool.chunk, 42 + Math.random() * 16, 40 + Math.random() * 12)
          shakeScreen(true)
        })
      }
      schedule(1500, () => addFx({ boom: true, emoji: '💥', x0: 50, y0: 46, x1: 50, y1: 46, size: 84, dur: 750 }, 800))
      return 2900
    }

    if (attackId === 'peace') {
      // screaming eagles dive on the hall
      const n = 4
      pool.chunk = damage / n
      for (let i = 0; i < n; i++) {
        const fromLeft = i % 2 === 0
        const x1 = 40 + Math.random() * 20
        const y1 = 38 + Math.random() * 10
        schedule(i * 200, () => {
          addFx({ src: '/siege/eagle1.png', src2: '/siege/eagle2.png', x0: fromLeft ? -8 : 108, y0: 14 + Math.random() * 26, x1, y1, size: 66, dur: 950, flip: !fromLeft }, 1050)
          schedule(950, () => {
            chipStrike(pool.chunk, x1, y1 - 3)
            addFx({ boom: true, emoji: '🪶', x0: x1, y0: y1, x1, y1, size: 40, dur: 700 }, 750)
          })
        })
      }
      return n * 200 + 1200
    }

    if (attackId === 'strength') {
      // missile barrage
      const n = 3
      pool.chunk = damage / n
      for (let i = 0; i < n; i++) {
        const x1 = 40 + i * 10 + Math.random() * 4
        const y1 = 40 + Math.random() * 8
        schedule(i * 260, () => {
          sfx.whoosh?.()
          addFx({ src: '/siege/missile.png', x0: 20 + i * 30, y0: 110, x1, y1, size: 90, dur: 720, easeIn: true }, 740)
          schedule(720, () => {
            addFx({ boom: true, emoji: '💥', x0: x1, y0: y1, x1, y1, size: 92, dur: 750 }, 800)
            chipStrike(pool.chunk, x1, y1 - 5)
            shakeScreen(true)
          })
        })
      }
      return n * 260 + 1100
    }

    // liberty — Lady Liberty herself drops on the hall
    pool.chunk = damage / 3
    addFx({ src: '/siege/statue.png', x0: 50, y0: -30, x1: 50, y1: 42, size: 240, dur: 950, easeIn: true }, 2400)
    schedule(950, () => {
      shakeScreen(true)
      const id = ++idRef.current
      setShockwaves(w => [...w, { id, x: 50, y: 50 }])
      schedule(900, () => setShockwaves(w => w.filter(s => s.id !== id)))
      for (let i = 0; i < 5; i++) {
        addFx({ emoji: '💨', x0: 50, y0: 50, x1: 26 + i * 12, y1: 44 + Math.random() * 12, size: 52, dur: 800 }, 900)
      }
      addFx({ boom: true, emoji: '💥', x0: 50, y0: 42, x1: 50, y1: 42, size: 110, dur: 750 }, 800)
    })
    for (let i = 0; i < 3; i++) {
      schedule(1000 + i * 240, () => chipStrike(pool.chunk, 42 + Math.random() * 16, 40 + Math.random() * 10))
    }
    return 2700
  }

  // ── Swipe → rock / firecracker along the swipe line ──────────────────────
  function launchThrow(x0: number, y0: number, x1: number, y1: number) {
    const st = S.current
    const now = Date.now()
    if (st.ended || now - st.lastThrow < THROW_COOLDOWN_MS) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const dirX = x1 - x0, dirY = y1 - y0
    if (dirY > -25) return // must swipe UP toward the fortress
    st.lastThrow = now
    st.throwCount++
    const kind: Projectile['kind'] = st.throwCount % 3 === 0 ? 'firecracker' : 'rock'

    // Extend the swipe vector until it reaches the hall band at center map
    const targetY = rect.height * (HALL_Y / 100 - 0.02)
    const k = (targetY - y0) / dirY
    const endX = Math.max(rect.width * 0.2, Math.min(rect.width * 0.8, x0 + dirX * k))

    const id = ++idRef.current
    setProjectiles(p => [...p, { id, x0, y0, x1: endX, y1: targetY, kind, launched: false }])
    requestAnimationFrame(() => requestAnimationFrame(() =>
      setProjectiles(p => p.map(pr => pr.id === id ? { ...pr, launched: true } : pr))))

    schedule(THROW_MS, () => {
      setProjectiles(p => p.filter(pr => pr.id !== id))
      const xPct = (endX / rect.width) * 100
      const yPct = (targetY / rect.height) * 100
      addSpark(xPct - 2, yPct - 3, kind === 'firecracker' ? '🧨💥' : '💥', '#fb923c')
      applyDamage(st.budget * (kind === 'firecracker' ? 0.10 : 0.055) * (0.85 + Math.random() * 0.3), xPct, yPct - 7)
    })
  }

  // ── Tap → deploy one of the LIMITED free troops at the tap spot ──────────
  function deploySoldier(x: number, y: number) {
    const st = S.current
    if (st.ended) return
    // Capped free units per assault (siege rework A2) — the horde is finite
    if (st.troopsUsed >= FREE_TROOPS) {
      showToast(`🪧 Out of ${troopName}! Use your gear or a special attack`)
      return
    }
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    st.troopsUsed++
    setTroopsLeft(FREE_TROOPS - st.troopsUsed)
    const sx = (x / rect.width) * 100
    const tx = HALL_X - 8 + Math.random() * 16
    const soldier: Soldier = {
      id: ++idRef.current,
      kind: 'troop',
      x: sx,
      y: (y / rect.height) * 100,
      tx,
      ty: HALL_Y + 4 + Math.random() * 8,
      flip: tx < sx, // frames face right — mirror when charging leftward
      state: 'march',
      spawnedAt: Date.now(),
      lastHit: 0,
      hits: 0,
      maxHits: troopMaxHits, // higher-level players' troops survive longer
    }
    soldiersRef.current = [...soldiersRef.current, soldier]
    setSoldiers(soldiersRef.current)
    sfx.whoosh?.()
    buzz(15)
  }

  // ── Soldier game loop: march → fight (chip damage) → fall ────────────────
  useEffect(() => {
    if (phase !== 'assault') return
    const iv = setInterval(() => {
      const now = Date.now()
      const st = S.current
      let changed = false
      const next = soldiersRef.current.map(s => {
        // Base defenses fire on troops: per-tick death roll scaled by how
        // close he is to the nearest turret — placement is the skill
        if (s.kind === 'troop' && (s.state === 'march' || s.state === 'fight')) {
          // approximate live position: use start point early in the march
          const px = s.state === 'fight' || now - s.spawnedAt > MARCH_MS / 2 ? s.tx : s.x
          const py = s.state === 'fight' || now - s.spawnedAt > MARCH_MS / 2 ? s.ty : s.y
          const dist = Math.min(...DEFENSE_GUNS.map(g => Math.hypot(px - g.x, py - g.y)))
          const danger = Math.max(0.4, Math.min(1.8, 1.7 - dist / 35))
          if (Math.random() < KILL_BASE[s.state] * danger) {
            changed = true
            const gun = DEFENSE_GUNS.reduce((a, b) => Math.hypot(px - a.x, py - a.y) < Math.hypot(px - b.x, py - b.y) ? a : b)
            addFx({ emoji: '⚫', x0: gun.x, y0: gun.y, x1: px, y1: py, size: 16, dur: 260, easeIn: true }, 280)
            schedule(260, () => addFx({ boom: true, emoji: '💥', x0: px, y0: py, x1: px, y1: py, size: 42, dur: 700 }, 750))
            return { ...s, state: 'poof' as const, hits: s.maxHits, lastHit: now }
          }
        }
        if (s.state === 'march' && (s.x !== s.tx || s.y !== s.ty)) {
          changed = true
          return { ...s, x: s.tx, y: s.ty }
        }
        if (s.state === 'march' && now - s.spawnedAt >= MARCH_MS + 250) {
          changed = true
          return { ...s, state: 'fight' as const, lastHit: now }
        }
        if (s.state === 'fight' && now - s.lastHit >= SOLDIER_HIT_MS && !st.ended) {
          changed = true
          if (s.kind === 'poor') chipStrike(strikePool.current.chunk, s.tx, s.ty - 6)
          else applyDamage(st.budget * 0.03 * troopPower * (0.85 + Math.random() * 0.3), s.tx, s.ty - 6)
          const hits = s.hits + 1
          return hits >= s.maxHits
            ? { ...s, state: 'poof' as const, hits, lastHit: now }
            : { ...s, hits, lastHit: now }
        }
        return s
      }).filter(s => !(s.state === 'poof' && now - s.lastHit > 700))
      if (changed || next.length !== soldiersRef.current.length) {
        soldiersRef.current = next
        setSoldiers(next)
      }
      // slow trickle so an abandoned assault still converges to its result
      if (!st.ended && st.dealt > 0 && now - st.lastThrow > 6000) {
        applyDamage(st.budget * 0.01, 46 + Math.random() * 8, 42)
      }
    }, 200)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Pointer input: short + still = tap (troop), else swipe (throw) ───────
  function onPointerDown(e: React.PointerEvent) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() }
  }

  function onPointerUp(e: React.PointerEvent) {
    const start = pointerRef.current
    pointerRef.current = null
    if (!start || phase !== 'assault') return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const dist = Math.hypot(x - start.x, y - start.y)
    const dt = Date.now() - start.t
    if (dist < 14 && dt < 400) deploySoldier(x, y)
    else launchThrow(start.x, start.y, x, y)
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

  return (
    <div
      ref={stageRef}
      className="relative overflow-hidden select-none bg-gray-950"
      style={{ height: 'calc(100dvh - 5rem)', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* ── The base map — 9:16 aerial, fills the whole screen, hall at the
             center X ─────────────────────────────────────────────────────── */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'url(/halls/hall_battle2.webp)',
        backgroundSize: 'cover', backgroundPosition: 'center',
        animation: bigShake ? 'sgShakeBig 0.5s ease-in-out' : shaking ? 'sgShake 0.24s ease-in-out' : undefined,
      }} />
      {/* readability gradients top + bottom */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(180deg, rgba(5,8,18,0.55) 0%, transparent 16%, transparent 72%, rgba(5,8,18,0.6) 100%)',
      }} />

      {/* ── HUD: defense bar ─────────────────────────────────────────────── */}
      <div className="absolute top-3 left-3 right-3 z-30 pointer-events-none">
        <div className="flex items-center justify-between mb-1">
          <span className="text-white text-xs font-black drop-shadow">🏛️ {gym.city_name} Town Hall</span>
          <span className="text-gray-200 text-xs font-bold tabular-nums drop-shadow">{defense.toLocaleString()} DEF</span>
        </div>
        <div className="h-3.5 bg-black/60 rounded-sm overflow-hidden border border-white/20">
          <div className="h-full transition-all duration-300"
            style={{ width: `${(defense / maxDefense) * 100}%`, background: `linear-gradient(90deg, ${holderColor}, ${holderColor}bb)` }} />
        </div>
        <div className="flex items-center justify-between mt-1">
          {gym.holder_username
            ? <p className="text-gray-300 text-[10px] drop-shadow">Held by {gym.holder_username}{gym.holder_party ? ` · ${gym.holder_party === 'democrat' ? 'Democrat' : 'Republican'}` : ''}</p>
            : <span />}
          <p className="text-yellow-300 text-[10px] font-bold drop-shadow">⚡ {profile.fp_balance?.toLocaleString()} FP</p>
        </div>
      </div>

      {/* ── banner ───────────────────────────────────────────────────────── */}
      {banner && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <span className="font-black" style={{
            fontSize: 46, letterSpacing: 2,
            color: banner === 'CAPTURED!' ? '#4ade80' : banner === 'DEFENSE HOLDS' ? '#f87171' : '#facc15',
            textShadow: '0 0 24px rgba(250,204,21,0.5), 0 4px 8px #000',
            animation: 'sgBanner 0.5s ease-out',
          }}>{banner}</span>
        </div>
      )}

      {/* ── projectiles ──────────────────────────────────────────────────── */}
      {projectiles.map(p => (
        <div key={p.id} className="absolute z-20 pointer-events-none" style={{
          left: p.launched ? p.x1 : p.x0,
          top: p.launched ? p.y1 : p.y0,
          transition: `left ${THROW_MS}ms cubic-bezier(0.3,0,0.8,1), top ${THROW_MS}ms cubic-bezier(0.3,0,0.8,1)`,
          transform: 'translate(-50%, -50%)',
        }}>
          <span className="block" style={{
            fontSize: p.kind === 'firecracker' ? 46 : 40,
            animation: `sgSpin ${THROW_MS}ms linear`,
            filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.6))',
          }}>{p.kind === 'firecracker' ? '🧨' : '🪨'}</span>
        </div>
      ))}

      {/* ── soldiers (party troops + the poor) ─────────────────────────────────── */}
      {soldiers.map(s => (
        <div key={s.id} className="absolute z-20 pointer-events-none" style={{
          left: `${s.x}%`,
          top: `${s.y}%`,
          transition: s.state === 'march' ? `left ${MARCH_MS}ms linear, top ${MARCH_MS}ms linear` : undefined,
          transform: `translate(-50%, -90%)${s.flip ? ' scaleX(-1)' : ''}`,
        }}>
          {s.state === 'poof' ? (
            <span style={{ fontSize: 26, animation: 'sgPoof 0.7s ease-out forwards' }}>💨</span>
          ) : (
            <span className="block relative" style={{
              width: 56,
              height: s.state === 'fight' ? 60 : 64,
              animation: s.state === 'march' ? 'sgRun 0.34s ease-in-out infinite' : 'sgLunge 0.62s ease-in-out infinite',
              filter: `drop-shadow(0 0 6px ${s.kind === 'poor' ? '#60a5fa' : myColor}) drop-shadow(0 2px 3px rgba(0,0,0,0.7))`,
            }}>
              <Flipbook
                frames={s.kind === 'poor'
                  ? (s.state === 'fight' ? POOR_ATK : POOR_RUN)
                  : (s.state === 'fight' ? TROOP_ATK : TROOP_RUN)}
                cycleMs={s.state === 'fight' ? 640 : 330}
              />
            </span>
          )}
        </div>
      ))}

      {/* ── special-attack fx ────────────────────────────────────────────── */}
      {fx.map(f => <FxItem key={f.id} f={f} />)}

      {/* ── shockwaves ───────────────────────────────────────────────────── */}
      {shockwaves.map(w => (
        <div key={w.id} className="absolute z-20 pointer-events-none rounded-full" style={{
          left: `${w.x}%`, top: `${w.y}%`,
          width: 30, height: 30,
          border: '4px solid rgba(255,255,255,0.85)',
          transform: 'translate(-50%, -50%)',
          animation: 'sgShockwave 0.85s ease-out forwards',
        }} />
      ))}

      {/* ── damage sparks ────────────────────────────────────────────────── */}
      {sparks.map(s => (
        <div key={s.id} className="absolute z-30 pointer-events-none" style={{ left: `${s.x}%`, top: `${s.y}%`, animation: 'sgSpark 0.85s ease-out forwards' }}>
          <span className="font-black text-xl" style={{ color: s.color, textShadow: `0 0 10px ${s.color}, 0 2px 4px #000` }}>{s.text}</span>
        </div>
      ))}

      {/* ── power flash: the server's exact roll, shown honestly (A3) ────── */}
      {powerFlash !== null && (
        <div className="absolute top-24 inset-x-0 z-40 text-center pointer-events-none">
          <span className="inline-block px-5 py-2 rounded-2xl font-black text-xl text-amber-300 bg-black/70 border border-amber-500/60"
            style={{ textShadow: '0 0 14px #f59e0b' }}>
            💥 ASSAULT POWER: {powerFlash.toLocaleString()} DEF
          </span>
        </div>
      )}

      {/* ── assault controls: GEAR TRAY + party SPECIAL ATTACKS + hint ───── */}
      {phase === 'assault' && (
        <div className="absolute bottom-3 left-3 right-3 z-30"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {/* owned gear — server-spent, real hall damage on top of the budget */}
          <div className="flex justify-center gap-2 mb-2">
            {(['firecracker', 'dynamite', 'rocket'] as const).map(itemId => {
              const count = inv[itemId] ?? 0
              const emoji = itemId === 'rocket' ? '🚀' : itemId === 'dynamite' ? '💣' : '🧨'
              return (
                <button key={itemId}
                  onPointerDown={e => e.stopPropagation()}
                  onPointerUp={e => e.stopPropagation()}
                  onClick={() => useGear(itemId)}
                  disabled={boostBusy || count <= 0}
                  className="relative rounded-xl px-3 py-1.5 border backdrop-blur transition active:scale-95 disabled:opacity-35"
                  style={{ background: 'rgba(10,14,26,0.85)', borderColor: count > 0 ? '#f59e0b' : '#374151' }}>
                  <span className="text-xl leading-none">{emoji}</span>
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] font-black flex items-center justify-center">
                    {count}
                  </span>
                </button>
              )
            })}
            {(inv.firecracker ?? 0) + (inv.dynamite ?? 0) + (inv.rocket ?? 0) === 0 && (
              <span className="self-center text-gray-400 text-[10px] font-bold bg-black/55 rounded-full px-3 py-1">
                📦 Out of gear — your Print Shop is making more
              </span>
            )}
          </div>
          <p className="text-center text-amber-300 text-[10px] font-black uppercase tracking-wider mb-1 drop-shadow">
            ⚡ Special Attacks
          </p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {myAttacks.map(a => {
              const afford = (profile.fp_balance ?? 0) >= a.fp
              return (
                <button key={a.id}
                  onPointerDown={e => e.stopPropagation()}
                  onPointerUp={e => e.stopPropagation()}
                  onClick={() => strike(a.id)}
                  disabled={strikeBusy || !afford}
                  className="rounded-xl py-2 px-1 text-center transition active:scale-95 disabled:opacity-45 border backdrop-blur"
                  style={{
                    background: 'rgba(10,14,26,0.85)',
                    borderColor: afford ? `${myColor}` : '#374151',
                    boxShadow: afford ? `0 0 14px ${myColor}66` : undefined,
                  }}>
                  <div className="text-2xl leading-none">{a.emoji}</div>
                  <p className="text-white text-[10px] font-black mt-0.5 leading-tight">{a.name}</p>
                  <p className="text-yellow-300 text-[9px] font-bold">⚡ {a.fp} FP</p>
                </button>
              )
            })}
          </div>
          <p className="text-center text-white/90 text-xs font-bold bg-black/55 backdrop-blur rounded-full px-4 py-1.5 mx-auto w-max max-w-full pointer-events-none">
            🪨 SWIPE to throw · 👆 TAP: <span className={troopsLeft > 0 ? 'text-emerald-300' : 'text-red-400'}>{troopsLeft} {troopName} left</span>
          </p>
        </div>
      )}

      {/* ── READY overlay ────────────────────────────────────────────────── */}
      {phase === 'ready' && (
        <div className="absolute inset-x-0 bottom-0 z-40 p-4 pb-8"
          style={{ background: 'linear-gradient(0deg, rgba(3,7,18,0.92) 40%, transparent 100%)' }}>
          <div className="w-full max-w-md mx-auto space-y-2.5">
            {samePartyHall ? (
              <div className="bg-gray-900/95 rounded-2xl p-4 text-center border border-gray-700">
                <p className="text-gray-200 text-sm mb-3">Your party holds this hall — donate to defend it instead!</p>
                <button onClick={() => router.push(`/townhall/${gym.id}`)}
                  className="w-full py-3 rounded-xl font-bold text-white transition"
                  style={{ background: myColor }}>
                  🏛️ Go Donate
                </button>
              </div>
            ) : (
              <>
                {/* honest assault math (siege rework A3): the roll owns the
                    ceiling — troops/throws just spend it, gear hits extra */}
                <div className="bg-gray-900/95 rounded-2xl p-3.5 border border-gray-700">
                  <p className="text-white text-sm font-black text-center">March on {gym.city_name} Town Hall — 100 FP</p>
                  <p className="text-gray-400 text-[11px] text-center mt-1.5 leading-snug">
                    Each assault rolls <span className="text-amber-300 font-black">~200–400 DEF</span> of attack power
                    (revealed at the bell). Your <span className="text-white font-bold">{FREE_TROOPS} {troopName}</span> and
                    throws spend that roll — <span className="text-amber-300 font-bold">gear 🧨💣🚀 and specials hit extra</span>.
                  </p>
                </div>
                <button onClick={beginAssault} disabled={busy || (profile.fp_balance ?? 0) < 100}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-black text-lg transition active:scale-95 shadow-2xl">
                  {busy ? '⏳ ...' : '⚔️ BEGIN ASSAULT (100 FP)'}
                </button>
                {!location && (
                  <p className="text-yellow-400 text-xs text-center">📍 Locating you... attack unlocks once your position is found</p>
                )}
              </>
            )}
            <button onClick={() => router.push(`/townhall/${gym.id}`)}
              className="w-full py-3 bg-gray-900/90 border border-gray-700 text-gray-300 rounded-xl font-bold text-sm hover:bg-gray-800 transition">
              🏛️ Back to Town Hall
            </button>
          </div>
        </div>
      )}

      {/* ── RESULT overlay ───────────────────────────────────────────────── */}
      {phase === 'result' && result && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-3">
            <div className="bg-gray-900/95 rounded-2xl p-5 text-center border border-gray-700">
              <div className="text-5xl mb-1">{result.captured ? '🏛️' : '🛡️'}</div>
              <h2 className="font-black text-2xl" style={{ color: result.captured ? '#4ade80' : '#f87171' }}>
                {result.captured ? 'HALL CAPTURED!' : 'DEFENSE HOLDS'}
              </h2>
              <p className="text-gray-400 text-sm mt-1">
                {result.captured
                  ? `${gym.city_name} flies your colors now! +50 FP bonus`
                  : `You dealt ${result.damage.toLocaleString()} damage — the hall still stands`}
              </p>
            </div>

            {result.captured ? (
              // Freshly captured — fortify it before rivals counterattack
              <>
                <p className="text-gray-300 text-xs text-center px-2">
                  🛡️ It's yours now — but rivals can attack it. Reinforce your defenses before they do!
                </p>
                <button onClick={() => router.push(`/townhall/${gym.id}`)}
                  className="w-full py-4 rounded-xl font-black text-white transition active:scale-95"
                  style={{ background: myColor }}>
                  🛡️ Add Defenses / Defense Points
                </button>
              </>
            ) : (
              <button onClick={() => setPhase('ready')}
                disabled={(profile.fp_balance ?? 0) < 100}
                className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-black transition active:scale-95">
                ⚔️ ATTACK AGAIN (100 FP)
              </button>
            )}

            <button onClick={() => router.push(`/townhall/${gym.id}`)}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold transition">
              🏛️ Back to Town Hall
            </button>
            <button onClick={() => router.push('/map')}
              className="w-full py-2.5 bg-gray-900/80 border border-gray-700 text-gray-400 rounded-xl font-bold text-sm hover:bg-gray-800 transition">
              🗺️ Back to Map
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
        </div>
      )}

      <style>{`
        @keyframes sgBanner { 0%{transform:scale(2.2);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes sgSpark { 0%{transform:translateY(0) scale(0.7);opacity:1} 100%{transform:translateY(-44px) scale(1.15);opacity:0} }
        @keyframes sgSpin { 0%{transform:rotate(0)} 100%{transform:rotate(660deg)} }
        @keyframes sgShake { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-7px,4px)} 50%{transform:translate(6px,-4px)} 75%{transform:translate(-4px,2px)} }
        @keyframes sgShakeBig { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-14px,8px)} 35%{transform:translate(12px,-9px)} 55%{transform:translate(-9px,5px)} 75%{transform:translate(6px,-4px)} }
        @keyframes sgRun { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes sgLunge { 0%,100%{transform:translateX(-2px)} 45%{transform:translateX(3px) scale(1.05)} }
        @keyframes sgPoof { 0%{transform:scale(0.7);opacity:1} 100%{transform:scale(1.8) translateY(-14px);opacity:0} }
        @keyframes sgBoom { 0%{transform:scale(0.2);opacity:0} 20%{transform:scale(1.25);opacity:1} 100%{transform:scale(1.6);opacity:0} }
        @keyframes sgShockwave { 0%{width:30px;height:30px;opacity:0.9} 100%{width:70vw;height:70vw;opacity:0} }
        @keyframes sgF2_0 { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes sgF2_1 { 0%,49%{opacity:0} 50%,100%{opacity:1} }
        @keyframes sgF3_0 { 0%,32%{opacity:1} 33%,100%{opacity:0} }
        @keyframes sgF3_1 { 0%,32%{opacity:0} 33%,65%{opacity:1} 66%,100%{opacity:0} }
        @keyframes sgF3_2 { 0%,65%{opacity:0} 66%,100%{opacity:1} }
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

'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { useLocation } from '@/hooks/useLocation'
import { sfx, buzz } from '@/lib/juice'
import { ITEMS, type ItemType } from '@/config/items'

// Siege Mode: attacking a town hall plays out over the fortified-hall
// scene. The server's challenge API stays fully authoritative — it is
// called ONCE per assault and rolls total damage + capture; the player
// then "spends" that damage budget interactively: swipes hurl rocks and
// firecrackers along the swipe line, taps deploy little soldiers at the
// tap spot who charge in and chip the defenses. The assault ends when
// the server-approved damage has all landed.

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
  x: number; y: number     // current position (%)
  tx: number; ty: number   // fight position at the walls (%)
  flip: boolean            // mirror the sprite to face the travel direction
  state: 'march' | 'fight' | 'poof'
  spawnedAt: number
  lastHit: number
  hits: number
}

interface Spark { id: number; x: number; y: number; text: string; color: string }

const MARCH_MS = 1100          // soldier travel time to the walls
const SOLDIER_HIT_MS = 850     // time between soldier strikes
const SOLDIER_MAX_HITS = 5     // strikes before the garrison takes him down
const MAX_SOLDIERS = 4
const THROW_MS = 420           // projectile flight time
const THROW_COOLDOWN_MS = 320

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
  const [banner, setBanner] = useState('')
  const [projectiles, setProjectiles] = useState<Projectile[]>([])
  const [soldiers, setSoldiers] = useState<Soldier[]>([])
  // The game loop owns the soldier list through this ref and mirrors it to
  // state for rendering — applying damage inside a setState updater would
  // double-fire it under StrictMode
  const soldiersRef = useRef<Soldier[]>([])
  const [sparks, setSparks] = useState<Spark[]>([])
  const [result, setResult] = useState<{ captured: boolean; damage: number; remaining: number } | null>(null)
  const [items, setItems] = useState<Record<string, number>>({})
  const [itemBusy, setItemBusy] = useState(false)

  const idRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // Assault bookkeeping lives in refs — pointer handlers and intervals
  // must read live values, not render-time snapshots
  const S = useRef({
    startDefense: 0,   // defense when the assault began
    budget: 0,         // total defense points this assault removes
    dealt: 0,
    captured: false,
    damage: 0,
    remaining: 0,
    throwCount: 0,
    lastThrow: 0,
    ended: false,
  })

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
          setPhase('ready')
        }
      })
      .catch(() => {})
  }, [gymId])

  // Boost inventory — also claims the daily free firecracker
  useEffect(() => {
    fetch('/api/items')
      .then(r => r.json())
      .then(d => {
        if (d.items) setItems(d.items)
        if (d.free_granted) showToast('🎁 Daily free Firecracker added to your bag!')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const holderColor = gym?.holder_party === 'democrat' ? '#2563eb' : gym?.holder_party === 'republican' ? '#dc2626' : '#9ca3af'
  const myColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const samePartyHall = !!gym?.holder_party && gym.holder_party === profile?.party

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

  function shakeScreen() {
    setShaking(true)
    schedule(240, () => setShaking(false))
  }

  // ── Damage bookkeeping: every hit spends part of the server's budget ─────
  function applyDamage(chunk: number, xPct: number, yPct: number) {
    const st = S.current
    if (st.ended || phase !== 'assault') return
    const dealt = Math.min(st.budget, st.dealt + chunk)
    const applied = Math.round(dealt - st.dealt)
    if (applied <= 0) return
    st.dealt = dealt
    setDefense(Math.max(0, Math.round(st.startDefense - dealt)))
    addSpark(xPct, yPct, `-${applied.toLocaleString()}`, '#facc15')
    shakeScreen()
    sfx.siegeBlow()
    buzz(30)
    if (dealt >= st.budget - 0.5) finishAssault()
  }

  function finishAssault() {
    const st = S.current
    if (st.ended) return
    st.ended = true
    setDefense(st.captured ? 0 : st.remaining)
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
      st.startDefense = defense
      st.captured = !!data.captured
      st.damage = data.damage ?? 0
      st.remaining = data.defense_remaining ?? 0
      st.budget = Math.max(1, st.captured ? defense : st.damage)
      st.dealt = 0
      st.throwCount = 0
      st.ended = false
      setPhase('assault')
      setBanner('ASSAULT!')
      sfx.bell(true)
      schedule(800, () => setBanner(''))
    } catch {
      showToast('❌ Attack failed')
      setBusy(false)
    }
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

    // Extend the swipe vector until it reaches the fortress band (~32% down)
    const targetY = rect.height * 0.32
    const k = (targetY - y0) / dirY
    const endX = Math.max(rect.width * 0.1, Math.min(rect.width * 0.9, x0 + dirX * k))

    const id = ++idRef.current
    setProjectiles(p => [...p, { id, x0, y0, x1: endX, y1: targetY, kind, launched: false }])
    // flip to launched on the next frame so the CSS transition runs
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

  // ── Tap → deploy a soldier at the tap spot ────────────────────────────────
  function deploySoldier(x: number, y: number) {
    const st = S.current
    if (st.ended) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const active = soldiersRef.current.filter(s => s.state !== 'poof')
    if (active.length >= MAX_SOLDIERS) {
      showToast('⚔️ Squad is maxed — wait for your soldiers to fall')
      return
    }
    const sx = (x / rect.width) * 100
    // charge to the fortress gate area, fanning out a little
    const tx = 41 + Math.random() * 18
    const soldier: Soldier = {
      id: ++idRef.current,
      x: sx,
      y: (y / rect.height) * 100,
      tx,
      ty: 60 + Math.random() * 8,
      flip: tx < sx, // frames face right — mirror when charging leftward
      state: 'march',
      spawnedAt: Date.now(),
      lastHit: 0,
      hits: 0,
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
        // first tick after spawn: set the destination so the CSS transition
        // animates from the tap point (initial paint) toward the walls
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
          applyDamage(st.budget * 0.03 * (0.85 + Math.random() * 0.3), s.tx, s.ty - 6)
          const hits = s.hits + 1
          return hits >= SOLDIER_MAX_HITS
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
        applyDamage(st.budget * 0.01, 48 + Math.random() * 8, 30)
      }
    }, 200)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Pointer input: short + still = tap (soldier), else swipe (throw) ─────
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

  async function useBoost(itemId: ItemType) {
    if (!gym || itemBusy) return
    const def = ITEMS.find(i => i.id === itemId)!
    setItemBusy(true)
    try {
      if ((items[itemId] ?? 0) > 0) {
        if (!location) { showToast('📍 Still finding your location...'); return }
        const res = await fetch(`/api/gyms/${gym.id}/boost`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: itemId, latitude: location.lat, longitude: location.lng }),
        })
        const data = await res.json()
        if (!res.ok) { showToast(`❌ ${data.message || data.error || 'Boost failed'}`); return }
        setItems(prev => ({ ...prev, [itemId]: data.quantity_left }))
        setDefense(data.defense_remaining)
        setMaxDefense(m => Math.max(m, 1))
        shakeScreen()
        addSpark(50, 30, `-${data.damage.toLocaleString()}`, '#fb923c')
        sfx.siegeBlow()
        buzz([60, 30, 60])
        if (data.defense_remaining <= 1) showToast('💥 Defense shattered — finish it with an assault!')
      } else {
        const res = await fetch('/api/items/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: itemId }),
        })
        const data = await res.json()
        if (!res.ok) { showToast(`❌ ${data.error || 'Purchase failed'}`); return }
        setItems(prev => ({ ...prev, [itemId]: data.quantity }))
        refetch()
        showToast(`${def.emoji} ${def.name} added — tap again to use it!`)
      }
    } catch { showToast('❌ Boost failed') }
    finally { setItemBusy(false) }
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

  const boostsGrid = (
    <div>
      <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1.5 text-center">💥 Battle Boosts — instant damage</p>
      <div className="grid grid-cols-3 gap-2">
        {ITEMS.map(it => {
          const qty = items[it.id] ?? 0
          return (
            <button key={it.id} onClick={() => useBoost(it.id)} disabled={itemBusy}
              className="bg-gray-900/90 border rounded-xl py-2 px-1 text-center transition active:scale-95 disabled:opacity-50"
              style={{ borderColor: qty > 0 ? '#f59e0b66' : '#374151' }}>
              <div className="text-2xl leading-none relative inline-block">
                {it.emoji}
                {qty > 0 && (
                  <span className="absolute -top-1.5 -right-3 bg-amber-500 text-black text-[9px] font-black rounded-full px-1.5 py-0.5">{qty}</span>
                )}
              </div>
              <p className="text-white text-[10px] font-bold mt-1">{it.name}</p>
              <p className={`text-[9px] ${qty > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                {qty > 0 ? `💥 -${it.damage.toLocaleString()} def` : `Buy · ${it.price} FP`}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div
      ref={stageRef}
      className="relative overflow-hidden select-none bg-gray-950"
      style={{ height: '100dvh', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* ── The fortified hall — full-screen battlefield ─────────────────── */}
      {/* blurred cover copy fills the letterbox; the sharp scene sits on top
          zoomed OUT (contain) so the whole fortress is in view */}
      <div className="absolute inset-0" style={{ animation: shaking ? 'sgShake 0.24s ease-in-out' : undefined }}>
        <div className="absolute inset-0" style={{
          backgroundImage: 'url(/halls/hall_battle.webp)',
          backgroundSize: 'cover', backgroundPosition: 'center 30%',
          filter: 'blur(22px) brightness(0.45)', transform: 'scale(1.1)',
        }} />
        <div className="absolute inset-0" style={{
          backgroundImage: 'url(/halls/hall_battle.webp)',
          backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center 42%',
        }} />
      </div>
      {/* readability gradients top + bottom */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(180deg, rgba(5,8,18,0.62) 0%, transparent 22%, transparent 68%, rgba(5,8,18,0.66) 100%)',
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
        {gym.holder_username && (
          <p className="text-gray-300 text-[10px] mt-1 drop-shadow">Held by {gym.holder_username}{gym.holder_party ? ` · ${gym.holder_party === 'democrat' ? 'Democrat' : 'Republican'}` : ''}</p>
        )}
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

      {/* ── soldiers ─────────────────────────────────────────────────────── */}
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
            // Two stacked pose frames alternating opacity = legs pumping on
            // the run, katana chopping in the fight
            <span className="block relative" style={{
              width: 56,
              height: s.state === 'fight' ? 62 : 66,
              animation: s.state === 'march' ? 'sgRun 0.34s ease-in-out infinite' : 'sgLunge 0.62s ease-in-out infinite',
              filter: `drop-shadow(0 0 6px ${myColor}) drop-shadow(0 2px 3px rgba(0,0,0,0.7))`,
            }}>
              {(s.state === 'fight' ? ['atk1', 'atk2'] : ['run1', 'run2']).map((frame, fi) => (
                <img key={frame} src={`/halls/soldier_${frame}.png`} alt="" draggable={false} style={{
                  position: 'absolute', bottom: 0, left: '50%',
                  height: '100%', width: 'auto', maxWidth: 'none',
                  transform: 'translateX(-50%)',
                  animation: `${fi === 0 ? 'sgFrameA' : 'sgFrameB'} ${s.state === 'fight' ? 620 : 340}ms steps(1) infinite`,
                }} />
              ))}
            </span>
          )}
        </div>
      ))}

      {/* ── damage sparks ────────────────────────────────────────────────── */}
      {sparks.map(s => (
        <div key={s.id} className="absolute z-30 pointer-events-none" style={{ left: `${s.x}%`, top: `${s.y}%`, animation: 'sgSpark 0.85s ease-out forwards' }}>
          <span className="font-black text-xl" style={{ color: s.color, textShadow: `0 0 10px ${s.color}, 0 2px 4px #000` }}>{s.text}</span>
        </div>
      ))}

      {/* ── assault hint ─────────────────────────────────────────────────── */}
      {phase === 'assault' && (
        <div className="absolute bottom-4 left-4 right-4 z-30 pointer-events-none">
          <p className="text-center text-white/90 text-xs font-bold bg-black/55 backdrop-blur rounded-full px-4 py-2 mx-auto w-max max-w-full">
            🪨 SWIPE up to hurl rocks · 👆 TAP to deploy soldiers
          </p>
        </div>
      )}

      {/* ── READY overlay ────────────────────────────────────────────────── */}
      {phase === 'ready' && (
        <div className="absolute inset-0 z-40 bg-black/55 flex items-end justify-center p-4 pb-8">
          <div className="w-full max-w-md space-y-3">
            {!samePartyHall && boostsGrid}
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
                <button onClick={beginAssault} disabled={busy || (profile.fp_balance ?? 0) < 100}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-black text-lg transition active:scale-95 shadow-2xl">
                  {busy ? '⏳ ...' : '⚔️ BEGIN ASSAULT (100 FP)'}
                </button>
                <p className="text-gray-300 text-xs text-center drop-shadow">
                  Then: swipe to throw rocks & firecrackers, tap anywhere to release soldiers into the town
                </p>
                {!location && (
                  <p className="text-yellow-400 text-xs text-center">📍 Locating you... attack unlocks once your position is found</p>
                )}
              </>
            )}
            <button onClick={() => router.back()}
              className="w-full py-3 bg-gray-900/90 border border-gray-700 text-gray-300 rounded-xl font-bold text-sm hover:bg-gray-800 transition">
              ← Retreat
            </button>
          </div>
        </div>
      )}

      {/* ── RESULT overlay ───────────────────────────────────────────────── */}
      {phase === 'result' && result && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-end justify-center p-4 pb-8">
          <div className="w-full max-w-md space-y-3">
            <div className="bg-gray-900/95 rounded-2xl p-5 text-center border border-gray-700">
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
            {!result.captured && boostsGrid}
            {!result.captured && (
              <button onClick={() => setPhase('ready')}
                disabled={(profile.fp_balance ?? 0) < 100}
                className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-black transition active:scale-95">
                ⚔️ ATTACK AGAIN (100 FP)
              </button>
            )}
            <button onClick={() => router.push('/map')}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold transition">
              Back to Map
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
        @keyframes sgRun { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes sgLunge { 0%,100%{transform:translateX(-2px)} 45%{transform:translateX(3px) scale(1.05)} }
        @keyframes sgFrameA { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes sgFrameB { 0%,49%{opacity:0} 50%,100%{opacity:1} }
        @keyframes sgPoof { 0%{transform:scale(0.7);opacity:1} 100%{transform:scale(1.8) translateY(-14px);opacity:0} }
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

'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { getEnemyById, getRandomEnemy, getEnemiesForParty } from '@/config/enemies'
import type { Enemy } from '@/config/enemies'
import { THROWS, TIER_DEFENSE } from '@/config/attacks'
import { fighterLevel } from '@/lib/fighter'
import { sfx, buzz } from '@/lib/juice'
import dynamic from 'next/dynamic'

// 3D enemy renderer (client-only). The battle stage is 3D-ONLY: every fighter
// renders through Enemy3D so size, ground contact, and motion are identical.
const Enemy3D = dynamic(() => import('@/components/Enemy3D'), { ssr: false })
const ENEMY_3D: Record<string, string> = Object.fromEntries(
  ['comrade', 'oil_baron', 'cowboy', 'politician', 'hick', 'ice_agent', 'soldier_boy', 'preppy', 'influencer',
   'billionaire', 'crazy_liberal', 'crying_liberal', 'dem_politician', 'purple_hair', 'protestor', 'anchor',
   'palestine', 'drag', 'senator'].map(id => [id, id]),
)

// ═════════════════════════════════════════════════════════════════════════════
// SPRITE BATTLE — 12-second showdown.
// Pokémon staging: one 3D sprite planted on the ground of a rotating backdrop,
// sidestepping left and right. TAP throws rocks (free), SWIPE UP throws
// firecrackers (rationed: level + 2 per battle — the only way to drop a
// legendary in time). Beat the sprite before the 12s timer runs out or it
// escapes. Winning ≠ keeping: the server rolls the capture, and low-level
// players can never keep a legendary. The sprite throws character-themed junk
// back — tap it mid-air to swat it away.
// ═════════════════════════════════════════════════════════════════════════════

const PLAYER_MAX_HP = 120
const BATTLE_MS = 12_000
const ROCK_CD = 320
const FC_CD = 650
// Sprites were dying too easily (Micha) — battle HP is scaled up from the
// config values. Server victory validation checks damage >= config hp, so a
// kill at scaled HP always validates.
const HP_SCALE = 1.4

// Rotating battle stages. `ground` = feet line, % from the bottom of the
// screen — tuned per backdrop so the sprite stands on the visible ground.
const BACKDROPS: { src: string; name: string; ground: number }[] = [
  { src: '/backgrounds/stage_capitol.jpg', name: 'Capitol Plaza', ground: 38 },
  { src: '/backgrounds/stage_mainstreet.jpg', name: 'Main Street', ground: 38 },
  { src: '/backgrounds/stage_desert.jpg', name: 'Desert Highway', ground: 38 },
  { src: '/backgrounds/stage_park.jpg', name: 'Rally Park', ground: 38 },
]

const TIER_LEVELS = { common: 12, rare: 35, legendary: 70 }
const TIER_COLORS = { common: '#9ca3af', rare: '#a78bfa', legendary: '#facc15' }

// Dodge eagerness + counterattack cadence. MOVEMENT itself is identical for
// every sprite — higher tiers just dodge more often and attack faster.
const TIER_AI = {
  common:    { dodge: 0.26, attackMs: 3200 },
  rare:      { dodge: 0.42, attackMs: 2600 },
  legendary: { dodge: 0.58, attackMs: 2100 },
}

// What each character throws back at you
const FOE_THROWS: Record<string, { emoji: string; label: string }> = {
  oil_baron:       { emoji: '🛢️', label: 'Crude Oil' },
  cowboy:          { emoji: '🪢', label: 'Lasso' },
  hick:            { emoji: '🫙', label: 'Moonshine Jug' },
  politician:      { emoji: '📜', label: 'Red Tape' },
  crazy_liberal:   { emoji: '☕', label: 'Oat Milk Latte' },
  crying_liberal:  { emoji: '💧', label: 'Tear Flood' },
  protestor:       { emoji: '🪧', label: 'Protest Sign' },
  purple_hair:     { emoji: '📢', label: 'Megaphone Blast' },
  ice_agent:       { emoji: '🧊', label: 'Ice Block' },
  soldier_boy:     { emoji: '🥾', label: 'Combat Boot' },
  preppy:          { emoji: '⛳', label: 'Golf Ball' },
  influencer:      { emoji: '🎤', label: 'Hot Mic' },
  billionaire:     { emoji: '🚀', label: 'Toy Rocket' },
  anchor:          { emoji: '📺', label: 'Breaking News' },
  palestine:       { emoji: '🍉', label: 'Watermelon' },
  comrade:         { emoji: '🚩', label: 'Red Banner' },
  drag:            { emoji: '💄', label: 'Lipstick Bomb' },
  senator:         { emoji: '💊', label: 'Tampon' },
  dem_politician:  { emoji: '📋', label: 'Regulations' },
}
const DEFAULT_FOE_THROW = { emoji: '🥾', label: 'Old Boot' }

interface Projectile {
  id: number
  side: 'mine' | 'foe'
  kind?: 'rock' | 'firecracker'
  emoji?: string
  x0: number; y0: number
  x1: number; y1: number
  dur: number
  deflected?: boolean
}

function HpBar({ current, max, color }: { current: number; max: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (current / max) * 100))
  const barColor = color ?? (pct > 50 ? '#22c55e' : pct > 25 ? '#facc15' : '#ef4444')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 800, fontFamily: 'monospace', minWidth: 20 }}>HP</span>
      <div style={{ flex: 1, height: 8, background: '#1f2937', borderRadius: 4, overflow: 'hidden', border: '1px solid #374151' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4,
          transition: 'width 0.4s ease, background-color 0.4s ease', boxShadow: `0 0 6px ${barColor}88`,
        }} />
      </div>
      <span style={{ color: '#6b7280', fontSize: 10, fontFamily: 'monospace', minWidth: 52, textAlign: 'right' }}>
        {Math.max(0, current)}/{max}
      </span>
    </div>
  )
}

// One flying object. Player projectiles use the real art; foe projectiles are
// character-themed emoji that grow as they approach and can be tapped away.
function Missile({ p, onDeflect }: { p: Projectile; onDeflect?: (id: number) => void }) {
  const [fly, setFly] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFly(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const dx = p.x1 - p.x0
  const dy = p.y1 - p.y0
  const body = p.side === 'mine'
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.kind === 'firecracker' ? '/battle/firecracker.png' : '/battle/rock.png'} alt=""
        style={{ width: p.kind === 'firecracker' ? 52 : 42, height: 'auto', display: 'block' }} draggable={false} />
    : <span style={{ fontSize: 30 }}>{p.emoji}</span>
  return (
    <div
      onPointerDown={p.side === 'foe' && onDeflect && !p.deflected ? (e => { e.stopPropagation(); onDeflect(p.id) }) : undefined}
      style={{
        position: 'absolute', left: p.x0, top: p.y0, zIndex: 30,
        transform: p.deflected
          ? `translate(${dx * 0.4 + (Math.random() > 0.5 ? 220 : -220)}px, ${dy * 0.4 - 120}px) rotate(720deg) scale(0.6)`
          : fly
            ? `translate(${dx}px, ${dy}px) rotate(${p.side === 'mine' ? 480 : 360}deg) scale(${p.side === 'foe' ? 1.7 : 0.85})`
            : 'translate(0px, 0px) rotate(0deg) scale(1)',
        transition: p.deflected
          ? 'transform 450ms ease-out'
          : fly ? `transform ${p.dur}ms ${p.side === 'foe' ? 'ease-in' : 'linear'}` : 'none',
        cursor: p.side === 'foe' ? 'pointer' : 'default',
        filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.5))',
        touchAction: 'none',
        padding: p.side === 'foe' ? 14 : 0,
        margin: p.side === 'foe' ? -14 : 0,
      }}
    >
      {body}
    </div>
  )
}

function BattleContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { profile, refetch } = useProfile()
  const enemyId = searchParams.get('enemy')
  const spawnId = searchParams.get('spawn')

  const [enemy, setEnemy] = useState<Enemy | null>(null)
  const [enemyHp, setEnemyHp] = useState(0)
  const [maxHp, setMaxHp] = useState(0)
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP)
  const [phase, setPhase] = useState<'fighting' | 'victory' | 'defeat' | 'escaped'>('fighting')
  // move log lives in a ref — resolves can land close together and the server
  // validates victory damage against this log, so it must never lag a render
  const movesRef = useRef<{ name: string; power: number; damage: number }[]>([])
  const [captured, setCaptured] = useState(false)
  const [fpEarned, setFpEarned] = useState(0)
  const [timeLeft, setTimeLeft] = useState(BATTLE_MS)

  // Stage: pick a backdrop once per battle
  const [stage] = useState(() => BACKDROPS[Math.floor(Math.random() * BACKDROPS.length)])

  // Sprite presentation — every sprite starts dead-center, feet on the line
  const [enemyX, setEnemyX] = useState(50)
  const [fcLeft, setFcLeft] = useState(0)
  const [spriteAnim, setSpriteAnim] = useState<'idle' | 'hit' | 'charge' | 'faint' | 'flee'>('idle')
  const [spriteKey, setSpriteKey] = useState(0)
  const [enemy3dReady, setEnemy3dReady] = useState(false)

  // Projectiles + effects
  const [projectiles, setProjectiles] = useState<Projectile[]>([])
  const [dmgNums, setDmgNums] = useState<{ id: number; val: number; onEnemy: boolean; color: string; xPct: number }[]>([])
  const [missAt, setMissAt] = useState<{ id: number; xPct: number } | null>(null)
  const [dialogLine, setDialogLine] = useState('')
  const [screenShake, setScreenShake] = useState(false)

  const playerLevel = fighterLevel(profile?.total_battles_won ?? 0)

  const arenaRef = useRef<HTMLDivElement>(null)
  const S = useRef({
    over: false,
    enemyHp: 0, playerHp: PLAYER_MAX_HP,
    rockCd: 0, fcCd: 0, nextFoeThrowAt: 0, dodgeBusyUntil: 0, nextStepAt: 0,
    exFrom: 50, exTo: 50, exStart: 0, exDur: 1,
    idc: 0, fcLeft: 0,
    endAt: 0,
  })
  const startTime = useRef(Date.now())

  // ── Keyframes ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById('battle-kf3')) return
    const s = document.createElement('style')
    s.id = 'battle-kf3'
    s.textContent = `
      @keyframes poke3dHit { 0%{transform:translateX(0)} 30%{transform:translateX(7px)} 65%{transform:translateX(-5px)} 100%{transform:translateX(0)} }
      @keyframes poke3dChrg { 0%,100%{transform:scale(1)} 55%{transform:scale(1.02)} }
      @keyframes pokeFaint { 0%{transform:translateY(0) rotate(0);opacity:1} 20%{transform:translateY(18px) rotate(14deg);opacity:0.85} 100%{transform:translateY(160px) rotate(42deg);opacity:0} }
      @keyframes screenShake { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-12px,-5px) rotate(-1deg)} 30%{transform:translate(12px,5px) rotate(1deg)} 50%{transform:translate(-7px,-3px)} 70%{transform:translate(7px,3px)} 85%{transform:translate(-3px,0)} }
      @keyframes dmgFloat { 0%{transform:translateX(-50%) translateY(0);opacity:1} 100%{transform:translateX(-50%) translateY(-60px);opacity:0} }
      @keyframes boomPop { 0%{transform:scale(0.3);opacity:1} 100%{transform:scale(2.4);opacity:0} }
      @keyframes fcPulse { 0%{transform:scale(1)} 40%{transform:scale(1.25)} 100%{transform:scale(1)} }
      @keyframes timerBlink { 0%,100%{opacity:1} 50%{opacity:0.45} }
    `
    document.head.appendChild(s)
  }, [])

  // ── Load the enemy (3D-only: non-rigged enemies swap to a rigged stand-in) ─
  useEffect(() => {
    if (!profile) return
    const opponentParty = profile.party === 'republican' ? 'democrat' : 'republican'
    let e = enemyId ? getEnemyById(enemyId) : getRandomEnemy(opponentParty)
    if (e && !ENEMY_3D[e.id]) {
      const tier = e.tier
      const pool = getEnemiesForParty(e.party).filter(x => ENEMY_3D[x.id] && x.tier === tier)
      if (pool.length) e = pool[Math.floor(Math.random() * pool.length)]
    }
    if (e && ENEMY_3D[e.id]) {
      setEnemy(e)
      const hp = Math.round(e.hp * HP_SCALE)
      setEnemyHp(hp); setMaxHp(hp)
      S.current.enemyHp = hp
      const now = Date.now()
      S.current.nextFoeThrowAt = now + 2200
      S.current.nextStepAt = now + 1600
      S.current.endAt = now + BATTLE_MS
      startTime.current = now
      const lvl = fighterLevel(profile.total_battles_won ?? 0)
      const fc = lvl + 2 // level 1 → 3, level 2 → 4, and so on
      S.current.fcLeft = fc
      setFcLeft(fc)
      setDialogLine(e.tier === 'legendary' && lvl < 15
        ? `⚠️ ${e.name} can NEVER be kept below Lv.15 — fight for the FP!`
        : `A wild ${e.name} appeared! 12 seconds — GO!`)
    }
  }, [enemyId, profile])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function playAnim(name: typeof spriteAnim) { setSpriteAnim(name); setSpriteKey(k => k + 1) }
  function shake() { setScreenShake(true); setTimeout(() => setScreenShake(false), 450) }
  function addDmg(val: number, onEnemy: boolean, color: string, xPct: number) {
    const id = ++S.current.idc
    setDmgNums(p => [...p, { id, val, onEnemy, color, xPct }])
    setTimeout(() => setDmgNums(p => p.filter(d => d.id !== id)), 1000)
  }

  function moveEnemyTo(x: number, dur = 600, clamp = true) {
    const st = S.current
    const now = Date.now()
    st.exFrom = enemyXAt(now)
    st.exTo = clamp ? Math.max(28, Math.min(72, x)) : x
    st.exStart = now
    st.exDur = dur
    setEnemyX(st.exTo)
  }
  // One standard sidestep — SAME move for every sprite in the game
  function sidestep(dur = 600) {
    const cur = enemyXAt(Date.now())
    const dir = cur > 62 ? -1 : cur < 38 ? 1 : (Math.random() < 0.5 ? -1 : 1)
    moveEnemyTo(cur + dir * (10 + Math.random() * 5), dur)
  }
  function enemyXAt(t: number) {
    const st = S.current
    const k = Math.max(0, Math.min(1, (t - st.exStart) / st.exDur))
    return st.exFrom + (st.exTo - st.exFrom) * k
  }

  // Geometry: the sprite box and its chest line, derived from the stage
  function geom() {
    const rect = arenaRef.current!.getBoundingClientRect()
    const boxPx = Math.min(rect.width * 0.72, 375)
    const feetY = rect.height * (1 - stage.ground / 100)
    const chestY = feetY - boxPx * 0.38
    return { rect, boxPx, feetY, chestY }
  }

  // ── Player throws: TAP = rock (auto-aim) · SWIPE UP = firecracker ─────────
  function launchThrow(x0: number, y0: number, x1: number, y1: number, kind: 'rock' | 'firecracker') {
    const st = S.current
    if (st.over || phase !== 'fighting' || !enemy || !arenaRef.current) return
    const now = Date.now()
    if (kind === 'rock') { if (now < st.rockCd) return; st.rockCd = now + ROCK_CD }
    else {
      if (now < st.fcCd) return
      if (st.fcLeft <= 0) { setDialogLine('🧨 Out of firecrackers!'); return }
      st.fcCd = now + FC_CD
      st.fcLeft -= 1; setFcLeft(st.fcLeft)
    }

    const { rect, boxPx, chestY } = geom()
    let endX: number
    if (kind === 'firecracker') {
      const dirY = (y1 - y0) || -1
      endX = x0 + (x1 - x0) * ((chestY - y0) / dirY)
    } else {
      endX = rect.width * (enemyXAt(now) / 100)
    }

    const weapon = THROWS[kind]
    const id = ++st.idc
    const dur = 400
    setProjectiles(p => [...p, { id, side: 'mine', kind, x0, y0, x1: endX, y1: chestY, dur }])
    sfx.whoosh()

    // The sprite may sidestep the incoming throw (dodgier tiers step more)
    const ai = TIER_AI[enemy.tier as keyof typeof TIER_AI] ?? TIER_AI.common
    if (Math.random() < ai.dodge && now > st.dodgeBusyUntil) {
      st.dodgeBusyUntil = now + 650
      setTimeout(() => { if (!S.current.over) sidestep(460) }, 60)
    }

    // Resolve at impact against the LIVE position
    setTimeout(() => {
      setProjectiles(p => p.filter(x => x.id !== id))
      if (S.current.over || !enemy) return
      const exPx = rect.width * (enemyXAt(Date.now()) / 100)
      const hitRadius = boxPx * 0.33
      if (Math.abs(endX - exPx) <= hitRadius) {
        const tierMult = TIER_DEFENSE[enemy.tier as keyof typeof TIER_DEFENSE]
        const dmg = Math.floor(weapon.damage * (0.8 + Math.random() * 0.4) * tierMult)
        S.current.enemyHp = Math.max(0, S.current.enemyHp - dmg)
        setEnemyHp(S.current.enemyHp)
        movesRef.current.push({ name: weapon.name, power: weapon.damage, damage: dmg })
        addDmg(dmg, true, weapon.color, (exPx / rect.width) * 100)
        playAnim('hit')
        sfx.punch(kind === 'firecracker')
        buzz(20)
        if (kind === 'firecracker') sfx.crowd(0.3)
        if (S.current.enemyHp <= 0) winBattle()
        else setTimeout(() => { if (!S.current.over) playAnim('idle') }, 500)
      } else {
        const missId = ++S.current.idc
        setMissAt({ id: missId, xPct: (endX / rect.width) * 100 })
        setTimeout(() => setMissAt(m => (m?.id === missId ? null : m)), 700)
        sfx.whoosh()
      }
    }, dur)
  }

  async function winBattle() {
    const st = S.current
    st.over = true
    playAnim('faint')
    sfx.ko()
    setDialogLine(`${enemy!.name} is down!`)
    if (spawnId) {
      try { localStorage.setItem(`spawn_dead_${spawnId}`, Date.now().toString()) } catch {}
    }
    const data = await recordBattle('victory', movesRef.current)
    setCaptured(!!data?.captured)
    setFpEarned(data?.fp_earned ?? enemy!.fpReward)
    setPhase('victory')
    if (data?.captured) sfx.capture(); else sfx.victory()
  }

  function loseBattle() {
    const st = S.current
    if (st.over) return
    st.over = true
    setDialogLine(`${enemy!.name} wins this round...`)
    recordBattle('defeat', movesRef.current).then(() => { setPhase('defeat'); sfx.defeat() })
  }

  function fleeTimeout() {
    const st = S.current
    if (st.over) return
    st.over = true
    playAnim('flee')
    setDialogLine(`⏱ Time! ${enemy!.name} got away!`)
    moveEnemyTo(130, 700, false)
    recordBattle('fled', movesRef.current).then(() => setTimeout(() => setPhase('escaped'), 650))
  }

  async function recordBattle(result: 'victory' | 'defeat' | 'fled', moves: any[]) {
    try {
      const res = await fetch('/api/battles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enemy_id: enemy!.id, result, moves_used: moves,
          duration_secs: Math.round((Date.now() - startTime.current) / 1000),
        }),
      })
      const data = await res.json()
      refetch()
      return data
    } catch { return null }
  }

  // ── The 12-second clock ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enemy || phase !== 'fighting') return
    const iv = setInterval(() => {
      const st = S.current
      if (st.over) return
      const left = st.endAt - Date.now()
      setTimeLeft(Math.max(0, left))
      if (left <= 0) fleeTimeout()
    }, 100)
    return () => clearInterval(iv)
  }, [enemy, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enemy AI: paced sidesteps + themed counterattacks ─────────────────────
  useEffect(() => {
    if (!enemy || phase !== 'fighting') return
    const ai = TIER_AI[enemy.tier as keyof typeof TIER_AI] ?? TIER_AI.common
    const theme = FOE_THROWS[enemy.id] ?? DEFAULT_FOE_THROW

    const iv = setInterval(() => {
      const st = S.current
      if (st.over || !arenaRef.current) return
      const now = Date.now()

      // one smooth sidestep at a time, paced so each finishes before the next
      if (now > st.dodgeBusyUntil && now > st.nextStepAt) {
        st.nextStepAt = now + 1500 + Math.random() * 900
        sidestep(600)
      }

      // themed counterattack
      if (now >= st.nextFoeThrowAt) {
        st.nextFoeThrowAt = now + ai.attackMs * (0.8 + Math.random() * 0.5)
        playAnim('charge')
        setDialogLine(`${enemy.name} throws ${theme.label}! Tap it!`)
        setTimeout(() => {
          if (S.current.over || !arenaRef.current) return
          const { rect, chestY } = geom()
          const fromX = rect.width * (enemyXAt(Date.now()) / 100)
          const toX = rect.width * (0.3 + Math.random() * 0.4)
          const toY = rect.height * 0.86
          const id = ++S.current.idc
          const dur = 1000
          setProjectiles(p => [...p, { id, side: 'foe', emoji: theme.emoji, x0: fromX, y0: chestY, x1: toX, y1: toY, dur }])
          sfx.tap()

          setTimeout(() => {
            setProjectiles(p => {
              const hit = p.find(x => x.id === id)
              if (hit && !hit.deflected && !S.current.over) {
                const move = enemy.moves[Math.floor(Math.random() * enemy.moves.length)]
                const scale = enemy.tier === 'legendary' ? 0.5 : enemy.tier === 'rare' ? 0.45 : 0.35
                const dmg = Math.max(1, Math.floor(move.damage * (0.7 + Math.random() * 0.6) * scale))
                S.current.playerHp = Math.max(0, S.current.playerHp - dmg)
                setPlayerHp(S.current.playerHp)
                addDmg(dmg, false, '#ef4444', 50)
                shake(); sfx.kick(); buzz(40)
                if (S.current.playerHp <= 0) loseBattle()
              }
              return p.filter(x => x.id !== id)
            })
          }, dur)
        }, 380)
      }
    }, 200)
    return () => clearInterval(iv)
  }, [enemy, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  function deflect(id: number) {
    setProjectiles(p => p.map(x => x.id === id ? { ...x, deflected: true } : x))
    sfx.block()
    buzz(15)
    setTimeout(() => setProjectiles(p => p.filter(x => x.id !== id)), 460)
  }

  // ── Input: TAP anywhere = rock · SWIPE up = firecracker ───────────────────
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null)
  function onDown(e: React.PointerEvent) {
    touchRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }
  function onUp(e: React.PointerEvent) {
    const t0 = touchRef.current
    touchRef.current = null
    if (!t0 || !arenaRef.current) return
    const rect = arenaRef.current.getBoundingClientRect()
    const x0 = e.clientX - rect.left, y0 = e.clientY - rect.top
    const dx = e.clientX - t0.x, dy = e.clientY - t0.y
    const dist = Math.hypot(dx, dy)
    const launchY = rect.height * 0.92
    if (dist > 40 && dy < -30) {
      // SWIPE UP → firecracker, aimed along the swipe
      launchThrow(t0.x - rect.left, launchY, x0, y0, 'firecracker')
    } else if (dist < 24) {
      // TAP → rock, auto-aimed
      launchThrow(x0, launchY, x0, y0, 'rock')
    }
  }

  if (!profile || !enemy) {
    return (
      <div style={{ minHeight: '100vh', background: '#050a14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 14 }}>Loading battle...</span>
      </div>
    )
  }

  const tierColor = TIER_COLORS[enemy.tier as keyof typeof TIER_COLORS] ?? '#9ca3af'
  const partyColor = profile.party === 'republican' ? '#dc2626' : '#2563eb'
  const enemyLevel = TIER_LEVELS[enemy.tier as keyof typeof TIER_LEVELS]
  const secsLeft = Math.ceil(timeLeft / 1000)
  const timerPct = (timeLeft / BATTLE_MS) * 100
  const timerColor = timeLeft > 6000 ? '#22c55e' : timeLeft > 3000 ? '#facc15' : '#ef4444'
  const theme = FOE_THROWS[enemy.id] ?? DEFAULT_FOE_THROW

  return (
    <div
      ref={arenaRef}
      onPointerDown={onDown}
      onPointerUp={onUp}
      style={{
        position: 'fixed', inset: 0, overflow: 'hidden', touchAction: 'none', userSelect: 'none',
        background: '#0a0f1a',
        animation: screenShake ? 'screenShake 0.45s ease' : undefined,
      }}
    >
      {/* ── Rotating backdrop ────────────────────────────────────────────────── */}
      <img src={stage.src} alt="" draggable={false} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0,
      }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(4,8,16,0.55) 0%, transparent 22%, transparent 62%, rgba(4,8,16,0.62) 100%)' }} />

      {/* ── Enemy card (top-left) ───────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 100, zIndex: 10, maxWidth: 320,
        background: 'rgba(8,12,22,0.92)', border: `2px solid ${tierColor}55`,
        borderRadius: 14, padding: '8px 12px', boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>{enemy.name}</span>
          <span style={{ color: tierColor, fontSize: 11, fontWeight: 800, border: `1px solid ${tierColor}66`, borderRadius: 8, padding: '1px 7px' }}>
            Lv.{enemyLevel}
          </span>
        </div>
        <HpBar current={enemyHp} max={maxHp} />
        <span style={{ display: 'inline-block', marginTop: 5, color: tierColor, fontSize: 9, fontWeight: 900, letterSpacing: 1.5, background: `${tierColor}1c`, borderRadius: 6, padding: '2px 8px' }}>
          {enemy.tier.toUpperCase()}
        </span>
      </div>

      {/* ── Flee ─────────────────────────────────────────────────────────────── */}
      {phase === 'fighting' && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={async () => { S.current.over = true; await recordBattle('fled', movesRef.current); router.push('/map') }}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 10,
            background: 'rgba(8,12,22,0.9)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 12, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
          🏃 Flee
        </button>
      )}

      {/* ── 12-second timer ──────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 86, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 'min(60vw, 260px)', textAlign: 'center' }}>
        <div style={{
          color: timerColor, fontWeight: 900, fontSize: 26, fontFamily: 'monospace',
          textShadow: '0 2px 8px rgba(0,0,0,0.9)',
          animation: timeLeft <= 3000 && phase === 'fighting' ? 'timerBlink 0.5s linear infinite' : undefined,
        }}>{secsLeft}s</div>
        <div style={{ height: 6, background: 'rgba(0,0,0,0.55)', borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.25)' }}>
          <div style={{ height: '100%', width: `${timerPct}%`, background: timerColor, transition: 'width 0.1s linear, background-color 0.4s' }} />
        </div>
      </div>

      {/* ── The sprite — 3D only, feet ON the stage ground line ─────────────── */}
      <div style={{
        position: 'absolute', bottom: `${stage.ground}%`, left: `${enemyX}%`, zIndex: 5,
        transform: 'translateX(-50%)',
        transition: `left ${S.current.exDur}ms ease-in-out`,
        pointerEvents: 'none',
      }}>
        {/* damage numbers over the sprite */}
        {dmgNums.filter(d => d.onEnemy).map(d => (
          <div key={d.id} style={{
            position: 'absolute', top: -8, left: '50%',
            fontSize: d.val >= 30 ? 36 : 28, fontWeight: 900,
            color: d.color, textShadow: `0 0 12px ${d.color}, 0 2px 4px rgba(0,0,0,0.8)`,
            animation: 'dmgFloat 1s ease-out forwards', zIndex: 20, whiteSpace: 'nowrap',
          }}>−{d.val}</div>
        ))}
        {/* faint remounts for its one-shot CSS animation; flee must NOT remount —
            a fresh canvas replays the model's load-in pose mid-exit */}
        <div key={spriteAnim === 'faint' ? `end${spriteKey}` : 'live'} style={{
          width: 'min(72vw, 375px)', aspectRatio: '1 / 1', position: 'relative',
          animation: spriteAnim === 'faint' ? 'pokeFaint 0.9s ease-in forwards'
            : spriteAnim === 'hit' ? `poke3dHit 420ms ease-in-out`
            : spriteAnim === 'charge' ? `poke3dChrg 380ms ease-in-out`
            : undefined,
          transformOrigin: 'bottom center',
          opacity: enemy3dReady ? 1 : 0, transition: 'opacity 250ms ease',
        }}>
          <Enemy3D prefix={ENEMY_3D[enemy.id]} attackKey={spriteAnim === 'charge' ? spriteKey : 0}
            onReady={() => setEnemy3dReady(true)} />
        </div>
      </div>
      {!enemy3dReady && (
        <div style={{ position: 'absolute', bottom: `${stage.ground + 6}%`, left: '50%', transform: 'translateX(-50%)', zIndex: 5, color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: 700, textShadow: '0 2px 6px #000' }}>
          {enemy.name} approaches…
        </div>
      )}

      {/* MISS marker */}
      {missAt && (
        <div style={{
          position: 'absolute', bottom: `${stage.ground + 8}%`, left: `${missAt.xPct}%`, zIndex: 25,
          transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.55)', fontWeight: 900, fontSize: 20,
          textShadow: '0 2px 6px #000', animation: 'dmgFloat 0.7s ease-out forwards',
        }}>MISS</div>
      )}

      {/* projectiles */}
      {projectiles.map(p => <Missile key={p.id} p={p} onDeflect={deflect} />)}

      {/* player damage numbers */}
      {dmgNums.filter(d => !d.onEnemy).map(d => (
        <div key={d.id} style={{
          position: 'absolute', bottom: 150, left: '50%',
          fontSize: 32, fontWeight: 900, color: d.color,
          textShadow: `0 0 12px ${d.color}`, animation: 'dmgFloat 1s ease-out forwards', zIndex: 40,
        }}>−{d.val}</div>
      ))}

      {/* ── Firecracker counter ─────────────────────────────────────────────── */}
      {phase === 'fighting' && (
        <div key={fcLeft} style={{
          position: 'absolute', bottom: 148, right: 14, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'rgba(8,12,22,0.92)', border: `2px solid ${fcLeft > 0 ? '#f97316' : '#374151'}88`,
          borderRadius: 999, padding: '7px 14px 7px 9px',
          animation: 'fcPulse 0.35s ease',
          opacity: fcLeft > 0 ? 1 : 0.55,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/battle/firecracker.png" alt="firecracker" style={{ width: 26, height: 'auto' }} draggable={false} />
          <span style={{ color: fcLeft > 0 ? '#fdba74' : '#6b7280', fontWeight: 900, fontSize: 17, fontFamily: 'monospace' }}>×{fcLeft}</span>
        </div>
      )}

      {/* ── Player card ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 96, left: 12, right: 12, zIndex: 10,
        background: 'rgba(8,12,22,0.92)', border: '2px solid rgba(255,255,255,0.16)',
        borderRadius: 14, padding: '8px 12px', boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ color: 'white', fontWeight: 800, fontSize: 13 }}>{profile.username} <span style={{ color: '#9ca3af', fontWeight: 700, fontSize: 11 }}>Lv.{playerLevel}</span></span>
          <span style={{ color: '#facc15', fontSize: 11, fontWeight: 700 }}>⚡ {profile.fp_balance.toLocaleString()}</span>
        </div>
        <HpBar current={playerHp} max={PLAYER_MAX_HP} />
      </div>

      {/* ── Dialog line ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 62, left: 0, right: 0, zIndex: 10,
        display: 'flex', justifyContent: 'center', padding: '0 16px', pointerEvents: 'none', minHeight: 22,
      }}>
        <span style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: 600, textShadow: '0 2px 8px rgba(0,0,0,0.9)', textAlign: 'center' }}>
          {dialogLine}
        </span>
      </div>

      {/* ── How to play (bottom) ────────────────────────────────────────────── */}
      {phase === 'fighting' && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          textAlign: 'center', padding: '8px 12px calc(12px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(0deg, rgba(4,8,14,0.9) 0%, transparent 100%)', pointerEvents: 'none',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700 }}>
            👆 TAP = rock · ☝️ SWIPE up = firecracker · TAP their {theme.emoji} to swat it
          </span>
        </div>
      )}

      {/* VICTORY overlay */}
      {phase === 'victory' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(4,8,16,0.78)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 44 }}>{captured ? '🎯' : '💨'}</div>
              <h2 style={{ color: 'white', fontWeight: 900, fontSize: 24, margin: '4px 0' }}>
                {captured ? `${enemy.name} Captured!` : `${enemy.name} slipped away!`}
              </h2>
              <p style={{ color: '#4ade80', fontSize: 14, fontWeight: 700, margin: 0 }}>+{fpEarned} FP earned!</p>
            </div>
            <div style={{
              background: `${tierColor}11`, border: `2px solid ${tierColor}44`, borderRadius: 14,
              padding: '14px', textAlign: 'center',
            }}>
              <img src={enemy.image} alt={enemy.name}
                style={{ width: 110, height: 110, objectFit: 'contain', filter: `drop-shadow(0 0 14px ${tierColor}66)${captured ? '' : ' grayscale(0.7)'}` }} />
              <p style={{ color: 'white', fontWeight: 800, fontSize: 14, margin: '6px 0 0' }}>
                {captured ? '📦 Added to your collection' : 'Beaten — but not caught'}
              </p>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: '2px 0 0' }}>
                {captured
                  ? 'Duplicates sell back for FP in your Collection'
                  : enemy.tier === 'legendary'
                    ? playerLevel < 15 ? 'Legendaries can only be kept at Lv.15+' : 'Legendaries rarely stay down — try again!'
                    : 'Win fast for a better capture chance!'}
              </p>
            </div>
            <button onClick={() => router.push('/map')}
              style={{ padding: '14px 0', background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)`, border: 'none', borderRadius: 12, color: 'white', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>
              Back to Map
            </button>
          </div>
        </div>
      )}

      {/* ESCAPED overlay (timer ran out) */}
      {phase === 'escaped' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(4,8,16,0.78)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 48 }}>⏱️</div>
            <h2 style={{ color: 'white', fontWeight: 900, fontSize: 22, margin: '4px 0' }}>{enemy.name} got away!</h2>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 12px', textAlign: 'center' }}>
              12 seconds is all you get. Hit harder and faster next time — firecrackers do triple damage.
            </p>
            <button onClick={() => router.push('/map')}
              style={{ width: '100%', padding: '12px 0', background: '#1f2937', border: '1px solid #374151', borderRadius: 12, color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              Back to Map
            </button>
          </div>
        </div>
      )}

      {/* DEFEAT overlay */}
      {phase === 'defeat' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(4,8,16,0.78)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 48 }}>💀</div>
            <h2 style={{ color: 'white', fontWeight: 900, fontSize: 22, margin: '4px 0' }}>Defeated!</h2>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 12px', textAlign: 'center' }}>
              {enemy.name}&apos;s {theme.label} was too much!
            </p>
            <button onClick={() => router.push('/map')}
              style={{ width: '100%', padding: '12px 0', background: '#1f2937', border: '1px solid #374151', borderRadius: 12, color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              Back to Map
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function BattlePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#050a14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 14 }}>Loading...</span>
      </div>
    }>
      <BattleContent />
    </Suspense>
  )
}

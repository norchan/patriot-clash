'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { getEnemyById, getRandomEnemy } from '@/config/enemies'
import type { Enemy } from '@/config/enemies'
import { THROWS, TIER_DEFENSE } from '@/config/attacks'
import { fighterLevel } from '@/lib/fighter'
import { sfx, buzz } from '@/lib/juice'
import dynamic from 'next/dynamic'

// 3D enemy renderer (client-only). Enemies with a 3D model use it instead of
// the 2D sprite.
const Enemy3D = dynamic(() => import('@/components/Enemy3D'), { ssr: false })
// value = model prefix in /public/models (<prefix>_idle.glb + <prefix>_throw.glb)
const ENEMY_3D: Record<string, string> = { comrade: 'comrade' }

// ═════════════════════════════════════════════════════════════════════════════
// SPRITE BATTLE — carnival dodgeball edition.
// Swipe toward the sprite to hurl rocks and firecrackers along your swipe
// line. The sprite sidesteps to dodge, pulls a hilarious OUCH face when you
// connect, and throws character-themed junk back (the Oil Baron throws oil).
// Tap incoming projectiles to swat them away. Win the fight = catch the
// sprite. No gestures to memorize, no FP per throw — pure aim.
// ═════════════════════════════════════════════════════════════════════════════

const PLAYER_MAX_HP = 150

// Enemy counterattack tuning (damage when their projectile lands on you)
const ENEMY_DMG_SCALE = { common: 0.32, rare: 0.45, legendary: 0.4 }

const TIER_LEVELS = { common: 12, rare: 35, legendary: 70 }

// How eagerly the sprite dodges an incoming throw, and how often it attacks
const TIER_AI = {
  common:    { dodge: 0.28, attackMs: 3600 },
  rare:      { dodge: 0.45, attackMs: 3000 },
  legendary: { dodge: 0.62, attackMs: 2400 },
}

// What each character throws back at you
const FOE_THROWS: Record<string, { emoji: string; label: string; splat: string }> = {
  oil_baron:       { emoji: '🛢️', label: 'Crude Oil',      splat: 'rgba(20,16,10,0.85)' },
  cowboy:          { emoji: '🪢', label: 'Lasso',          splat: 'rgba(146,102,52,0.55)' },
  eagle:           { emoji: '🪶', label: 'Feather Dart',   splat: 'rgba(220,215,200,0.5)' },
  hick:            { emoji: '🫙', label: 'Moonshine Jug',  splat: 'rgba(210,180,120,0.55)' },
  politician:      { emoji: '📜', label: 'Red Tape',       splat: 'rgba(200,60,60,0.5)' },
  crazy_liberal:   { emoji: '☕', label: 'Oat Milk Latte', splat: 'rgba(160,120,80,0.6)' },
  crying_liberal:  { emoji: '💧', label: 'Tear Flood',     splat: 'rgba(96,165,250,0.55)' },
  politician_dems: { emoji: '📋', label: 'Regulations',    splat: 'rgba(59,130,246,0.5)' },
  protestor:       { emoji: '🪧', label: 'Protest Sign',   splat: 'rgba(250,204,21,0.5)' },
  purple_hair:     { emoji: '📢', label: 'Megaphone Blast', splat: 'rgba(168,85,247,0.55)' },
  ice_agent:       { emoji: '🧊', label: 'Ice Block',      splat: 'rgba(147,197,253,0.65)' },
  soldier_boy:     { emoji: '🥾', label: 'Combat Boot',    splat: 'rgba(120,110,80,0.6)' },
  preppy:          { emoji: '⛳', label: 'Golf Ball',      splat: 'rgba(134,180,90,0.55)' },
  influencer:      { emoji: '🎤', label: 'Hot Mic',        splat: 'rgba(120,120,130,0.6)' },
  billionaire:     { emoji: '🚀', label: 'Toy Rocket',     splat: 'rgba(251,146,60,0.6)' },
  anchor:          { emoji: '📺', label: 'Breaking News',  splat: 'rgba(96,165,250,0.55)' },
  palestine:       { emoji: '🍉', label: 'Watermelon',     splat: 'rgba(220,60,60,0.55)' },
  comrade:         { emoji: '🚩', label: 'Red Banner',     splat: 'rgba(200,40,40,0.6)' },
  drag:            { emoji: '💄', label: 'Lipstick Bomb',  splat: 'rgba(219,39,119,0.55)' },
  senator:         { emoji: '💊', label: 'Tampon',         splat: 'rgba(220,70,90,0.5)' },
}
const DEFAULT_FOE_THROW = { emoji: '🥾', label: 'Old Boot', splat: 'rgba(120,100,80,0.55)' }

interface Projectile {
  id: number
  side: 'mine' | 'foe'
  emoji: string
  x0: number; y0: number     // px, arena coords
  x1: number; y1: number
  dur: number
  deflected?: boolean
}

function HpBar({ current, max }: { current: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (current / max) * 100))
  const barColor = pct > 50 ? '#22c55e' : pct > 25 ? '#facc15' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: '#9ca3af', fontSize: 11, fontWeight: 800, fontFamily: 'monospace', minWidth: 20 }}>HP</span>
      <div style={{ flex: 1, height: 8, background: '#1f2937', borderRadius: 4, overflow: 'hidden', border: '1px solid #374151' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: barColor,
          borderRadius: 4,
          transition: 'width 0.5s ease, background-color 0.5s ease',
          boxShadow: `0 0 6px ${barColor}88`,
        }} />
      </div>
      <span style={{ color: '#6b7280', fontSize: 10, fontFamily: 'monospace', minWidth: 52, textAlign: 'right' }}>
        {current}/{max}
      </span>
    </div>
  )
}

// One flying object. Mounts at its start point, then glides to its end point;
// foe projectiles grow as they approach (depth) and can be tapped to deflect.
function Missile({ p, onDeflect }: { p: Projectile; onDeflect?: (id: number) => void }) {
  const [fly, setFly] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFly(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const dx = p.x1 - p.x0
  const dy = p.y1 - p.y0
  return (
    <div
      onPointerDown={p.side === 'foe' && onDeflect && !p.deflected ? (e => { e.stopPropagation(); onDeflect(p.id) }) : undefined}
      style={{
        position: 'absolute', left: p.x0, top: p.y0, zIndex: 30,
        fontSize: p.side === 'foe' ? 30 : 40,
        transform: p.deflected
          ? `translate(${dx * 0.4 + (Math.random() > 0.5 ? 220 : -220)}px, ${dy * 0.4 - 120}px) rotate(720deg) scale(0.6)`
          : fly
            ? `translate(${dx}px, ${dy}px) rotate(${p.side === 'mine' ? 540 : 360}deg) scale(${p.side === 'foe' ? 1.7 : 0.9})`
            : 'translate(0px, 0px) rotate(0deg) scale(1)',
        transition: p.deflected
          ? 'transform 450ms ease-out'
          : fly ? `transform ${p.dur}ms ${p.side === 'foe' ? 'ease-in' : 'linear'}` : 'none',
        cursor: p.side === 'foe' ? 'pointer' : 'default',
        filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.5))',
        touchAction: 'none',
        padding: p.side === 'foe' ? 14 : 0, // fat hit target for swatting
        margin: p.side === 'foe' ? -14 : 0,
      }}
    >
      {p.emoji}
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
  const [phase, setPhase] = useState<'fighting' | 'victory' | 'defeat'>('fighting')
  const [movesUsed, setMovesUsed] = useState<any[]>([])
  const [captured, setCaptured] = useState(false)
  const [fpEarned, setFpEarned] = useState(0)

  // Sprite presentation
  const [enemyX, setEnemyX] = useState(50)           // % across the arena
  const [enemyY, setEnemyY] = useState(0)            // px vertical dodge offset
  const [fcLeft, setFcLeft] = useState(0)            // firecrackers remaining
  const [ouch, setOuch] = useState(false)            // comic OUCH face
  const [spriteAnim, setSpriteAnim] = useState<'idle' | 'lowHp' | 'hit' | 'charge' | 'faint'>('idle')
  const [spriteKey, setSpriteKey] = useState(0)
  const [enemy3dReady, setEnemy3dReady] = useState(false) // 3D model finished loading
  const ouchMissing = useRef(false)                  // no _ouch.png for this enemy
  const [throwGone, setThrowGone] = useState(false)  // no _throw.png → single-frame

  // Projectiles + effects
  const [projectiles, setProjectiles] = useState<Projectile[]>([])
  const [splat, setSplat] = useState<{ color: string; emoji: string } | null>(null)
  const [screenShake, setScreenShake] = useState(false)
  const [dmgNums, setDmgNums] = useState<{ id: number; val: number; onEnemy: boolean; color: string; xPct: number }[]>([])
  const [missAt, setMissAt] = useState<{ id: number; xPct: number } | null>(null)
  const [dialogLine, setDialogLine] = useState('')

  // ── Level-based difficulty ─────────────────────────────────────────────
  // Underleveled players face meaner sprites: better dodges, harder counter
  // hits, and their own throws chip less. The Don is a WALL below level 5.
  const playerLevel = fighterLevel(profile?.total_battles_won ?? 0)
  const diff = (() => {
    if (!enemy) return { dodgeBonus: 0, foeDmgMult: 1, playerDmgMult: 1, donGate: false }
    const reqLevel = enemy.minLevel ?? (enemy.tier === 'legendary' ? 4 : enemy.tier === 'rare' ? 3 : 1)
    const donGate = enemy.id === 'politician' && playerLevel < 5
    const gap = Math.max(0, reqLevel - playerLevel)
    const lowVsCommon = enemy.tier === 'common' && playerLevel <= 2
    return {
      donGate,
      dodgeBonus: donGate ? 0.32 : Math.min(0.24, gap * 0.08) + (lowVsCommon ? 0.05 : 0),
      foeDmgMult: donGate ? 2.4 : 1 + Math.min(1.2, gap * 0.35) + (lowVsCommon ? 0.3 : 0),
      playerDmgMult: donGate ? 0.35 : 1 / (1 + Math.min(1, gap * 0.3)),
    }
  })()
  const diffRef = useRef(diff)
  diffRef.current = diff

  const arenaRef = useRef<HTMLDivElement>(null)
  const S = useRef({
    over: false,
    enemyHp: 0, playerHp: PLAYER_MAX_HP,
    throwCd: 0, nextFoeThrowAt: 0, dodgeBusyUntil: 0,
    // enemy x tween tracking, for hit tests against a MOVING target
    exFrom: 50, exTo: 50, exStart: 0, exDur: 1,
    ey: 0,  // current vertical dodge offset (px)
    swipe: null as { x: number; y: number; t: number } | null,
    idc: 0,
    throwsMade: 0,
    hitCount: 0,
    fcLeft: 0,  // firecrackers remaining this battle
  })
  const startTime = useRef(Date.now())

  // ── Keyframes ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById('battle-kf2')) return
    const s = document.createElement('style')
    s.id = 'battle-kf2'
    s.textContent = `
      /* Constant throwing motion: bob → wind up (lean back, twist) → snap forward */
      @keyframes pokeIdle { 0%,100%{transform:translateY(0) rotate(0) scaleX(1)} 30%{transform:translateY(-6px) rotate(-7deg) scaleX(0.96)} 46%{transform:translateY(-3px) rotate(9deg) scaleX(1.04)} 60%{transform:translateY(0) rotate(2deg)} }
      @keyframes pokeLowHp { 0%,100%{transform:translateY(0) rotate(-8deg) scale(0.97)} 35%{transform:translateY(-5px) rotate(6deg) scale(1.03)} 55%{transform:translateY(0) rotate(-3deg)} }
      @keyframes pokeHit { 0%{transform:translateX(0)} 20%{transform:translateX(14px) rotate(6deg)} 45%{transform:translateX(-11px) rotate(-6deg)} 70%{transform:translateX(6px)} 100%{transform:translateX(0)} }
      @keyframes pokeChrg { 0%{transform:rotate(0) translateX(0)} 35%{transform:rotate(-14deg) translateX(-10px)} 70%{transform:rotate(16deg) translateX(14px); filter:brightness(1.5)} 100%{transform:rotate(0) translateX(0)} }
      @keyframes pokeFaint { 0%{transform:translateY(0) rotate(0);opacity:1} 20%{transform:translateY(18px) rotate(14deg);opacity:0.85} 100%{transform:translateY(160px) rotate(42deg);opacity:0} }
      @keyframes screenShake { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-12px,-5px) rotate(-1deg)} 30%{transform:translate(12px,5px) rotate(1deg)} 50%{transform:translate(-7px,-3px)} 70%{transform:translate(7px,3px)} 85%{transform:translate(-3px,0)} }
      @keyframes dmgFloat { 0%{transform:translateX(-50%) translateY(0);opacity:1} 100%{transform:translateX(-50%) translateY(-60px);opacity:0} }
      @keyframes splatFade { 0%{opacity:0.95; transform:scale(0.7)} 25%{opacity:0.9; transform:scale(1.05)} 100%{opacity:0; transform:scale(1.15)} }
      @keyframes starTwinkle { 0%,100%{opacity:0.3} 50%{opacity:0.9} }
      @keyframes boomPop { 0%{transform:scale(0.3);opacity:1} 100%{transform:scale(2.4);opacity:0} }
      /* Constant cock-and-throw: hold the wind-up, snap to the release, repeat */
      @keyframes throwCycleA { 0%,52%{opacity:1} 60%,86%{opacity:0} 94%,100%{opacity:1} }
      @keyframes throwCycleB { 0%,52%{opacity:0} 60%,86%{opacity:1} 94%,100%{opacity:0} }
    `
    document.head.appendChild(s)
  }, [])

  // ── Load the enemy ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return
    const opponentParty = profile.party === 'republican' ? 'democrat' : 'republican'
    const e = enemyId ? getEnemyById(enemyId) : getRandomEnemy(opponentParty)
    if (e) {
      setEnemy(e)
      setThrowGone(false)  // assume a _throw frame until an onError proves otherwise
      ouchMissing.current = false
      setEnemyHp(e.hp)
      setMaxHp(e.hp)
      S.current.enemyHp = e.hp
      S.current.nextFoeThrowAt = Date.now() + 2500
      const lvl = fighterLevel(profile.total_battles_won ?? 0)
      const req = e.minLevel ?? (e.tier === 'legendary' ? 4 : e.tier === 'rare' ? 3 : 1)
      // Firecracker allowance: 3 at low levels → 10 at the highest
      const fc = Math.max(3, Math.min(10, 3 + Math.floor((lvl - 1) * 0.5)))
      S.current.fcLeft = fc
      setFcLeft(fc)
      setDialogLine(e.id === 'politician' && lvl < 5
        ? `⚠️ ${e.name} is WAY above your level. This will not go well...`
        : lvl < req
          ? `⚠️ ${e.name} outclasses you (Lv.${req} fight). TAP rocks · SWIPE firecrackers!`
          : `A wild ${e.name} appeared! TAP for rocks · SWIPE for firecrackers!`)
    }
  }, [enemyId, profile])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function playAnim(name: typeof spriteAnim) {
    setSpriteAnim(name)
    setSpriteKey(k => k + 1)
  }
  function shake() {
    setScreenShake(true)
    setTimeout(() => setScreenShake(false), 450)
  }
  function addDmg(val: number, onEnemy: boolean, color: string, xPct: number) {
    const id = ++S.current.idc
    setDmgNums(p => [...p, { id, val, onEnemy, color, xPct }])
    setTimeout(() => setDmgNums(p => p.filter(d => d.id !== id)), 1000)
  }

  function moveEnemyTo(x: number, dur = 380, y?: number) {
    const st = S.current
    const now = Date.now()
    st.exFrom = enemyXAt(now)
    st.exTo = Math.max(16, Math.min(84, x))
    st.exStart = now
    st.exDur = dur
    setEnemyX(st.exTo)
    // Vertical dodge too — the sprite juks in all directions
    if (y !== undefined) {
      st.ey = Math.max(-32, Math.min(70, y))
      setEnemyY(st.ey)
    }
  }
  // A quick evasive juke in a random direction (used when a throw is incoming)
  function jukeEnemy(dur = 300) {
    const cur = enemyXAt(Date.now())
    const dx = (Math.random() < 0.5 ? -1 : 1) * (16 + Math.random() * 16)
    const dy = -24 + Math.random() * 88
    moveEnemyTo(cur + dx, dur, dy)
  }
  function enemyXAt(t: number) {
    const st = S.current
    const k = Math.max(0, Math.min(1, (t - st.exStart) / st.exDur))
    return st.exFrom + (st.exTo - st.exFrom) * k
  }

  // ── Player throw: TAP = rock (auto-aim), SWIPE up = firecracker (aimed) ────
  function launchThrow(x0: number, y0: number, x1: number, y1: number, kind: keyof typeof THROWS) {
    const st = S.current
    if (st.over || phase !== 'fighting' || !enemy || !arenaRef.current) return
    const now = Date.now()
    if (now < st.throwCd) return
    st.throwCd = now + 300

    const rect = arenaRef.current.getBoundingClientRect()
    // The sprite band tracks its live vertical dodge offset
    const enemyCy = rect.height * 0.30 + st.ey
    let endX: number
    if (kind === 'firecracker') {
      // aim along the swipe vector
      const dirY = (y1 - y0) || -1
      endX = x0 + (x1 - x0) * ((enemyCy - y0) / dirY)
    } else {
      // rocks auto-aim at the sprite's current x
      endX = rect.width * (enemyXAt(now) / 100)
    }

    st.throwsMade++
    const weapon = THROWS[kind]
    const id = ++st.idc
    const dur = 430
    setProjectiles(p => [...p, { id, side: 'mine', emoji: weapon.emoji, x0, y0, x1: endX, y1: enemyCy, dur }])
    sfx.whoosh()

    // The sprite may juke mid-flight in ANY direction (dodgier vs underleveled)
    const ai = TIER_AI[enemy.tier as keyof typeof TIER_AI] ?? TIER_AI.common
    if (Math.random() < Math.min(0.92, ai.dodge + diffRef.current.dodgeBonus) && now > st.dodgeBusyUntil) {
      st.dodgeBusyUntil = now + 620
      setTimeout(() => { if (!S.current.over) jukeEnemy(300) }, 80)
    }

    // Resolve at impact time against the sprite's LIVE position
    setTimeout(() => {
      setProjectiles(p => p.filter(x => x.id !== id))
      if (S.current.over || !enemy) return
      const impactT = Date.now()
      const exPct = enemyXAt(impactT)
      const exPx = rect.width * (exPct / 100)
      const hitRadius = Math.min(rect.width * 0.13, 78)
      // Vertical dodge counts too: the projectile aimed at enemyCy (launch),
      // the sprite may have juked up/down since
      const nowCy = rect.height * 0.30 + S.current.ey
      const vGap = Math.abs(nowCy - enemyCy)
      if (Math.abs(endX - exPx) <= hitRadius && vGap <= 64) {
        // HIT — comic ouch + damage (underleveled players chip for less)
        const tierMult = TIER_DEFENSE[enemy.tier as keyof typeof TIER_DEFENSE]
        const dmg = Math.floor(weapon.damage * (0.8 + Math.random() * 0.4) * tierMult * diffRef.current.playerDmgMult)
        S.current.enemyHp = Math.max(0, S.current.enemyHp - dmg)
        setEnemyHp(S.current.enemyHp)
        setMovesUsed(p => [...p, { name: weapon.name, power: weapon.damage, damage: dmg }])
        addDmg(dmg, true, weapon.color, exPct)
        // Comic OUCH face only lands every few hits — every hit was overkill
        S.current.hitCount = (S.current.hitCount ?? 0) + 1
        const showOuch = !ouchMissing.current && (S.current.hitCount % 3 === 0 || kind === 'firecracker')
        if (showOuch) setOuch(true)
        playAnim('hit')
        sfx.punch(kind === 'firecracker')
        buzz(20)
        if (kind === 'firecracker') { sfx.crowd(0.3) }
        setDialogLine(`Direct hit with ${weapon.name}!`)
        setTimeout(() => {
          setOuch(false)
          if (!S.current.over) playAnim(S.current.enemyHp <= maxHp * 0.25 ? 'lowHp' : 'idle')
        }, 650)
        if (S.current.enemyHp <= 0) winBattle(dmg, weapon)
      } else {
        // MISS — it dodged
        const missId = ++S.current.idc
        setMissAt({ id: missId, xPct: (endX / rect.width) * 100 })
        setTimeout(() => setMissAt(m => (m?.id === missId ? null : m)), 800)
        setDialogLine(`${enemy.name} dodged it!`)
        sfx.whoosh()
      }
    }, dur)
  }

  async function winBattle(lastDmg: number, weapon: typeof THROWS['rock']) {
    const st = S.current
    st.over = true
    playAnim('faint')
    sfx.ko()
    setDialogLine(`${enemy!.name} is down!`)
    if (spawnId) {
      try { localStorage.setItem(`spawn_dead_${spawnId}`, Date.now().toString()) } catch {}
    }
    const moves = [...movesUsed, { name: weapon.name, power: weapon.damage, damage: lastDmg }]
    const data = await recordBattle('victory', 0, moves)
    setCaptured(!!data?.captured)
    setFpEarned(data?.fp_earned ?? enemy!.fpReward)
    setPhase('victory')
    sfx.victory()
  }

  // ── Enemy AI: wander, and throw themed junk back ──────────────────────────
  useEffect(() => {
    if (!enemy || phase !== 'fighting') return
    const ai = TIER_AI[enemy.tier as keyof typeof TIER_AI] ?? TIER_AI.common
    const theme = FOE_THROWS[enemy.id] ?? DEFAULT_FOE_THROW

    const iv = setInterval(() => {
      const st = S.current
      if (st.over || !arenaRef.current) return
      const now = Date.now()

      // idle wander — roams in all directions
      if (now > st.dodgeBusyUntil && Math.random() < 0.3) {
        moveEnemyTo(20 + Math.random() * 60, 520, -20 + Math.random() * 80)
      }

      // themed counterattack
      if (now >= st.nextFoeThrowAt) {
        st.nextFoeThrowAt = now + ai.attackMs * (0.8 + Math.random() * 0.5)
        const rect = arenaRef.current.getBoundingClientRect()
        playAnim('charge')
        setDialogLine(`${enemy.name} throws ${theme.label}! Tap it!`)
        setTimeout(() => {
          if (S.current.over || !arenaRef.current) return
          const r = arenaRef.current.getBoundingClientRect()
          const fromX = r.width * (enemyXAt(Date.now()) / 100)
          const fromY = r.height * 0.30
          const toX = r.width * (0.3 + Math.random() * 0.4)
          const toY = r.height * 0.86
          const id = ++S.current.idc
          const dur = 1050
          setProjectiles(p => [...p, { id, side: 'foe', emoji: theme.emoji, x0: fromX, y0: fromY, x1: toX, y1: toY, dur }])
          sfx.tap()

          setTimeout(() => {
            setProjectiles(p => {
              const hit = p.find(x => x.id === id && !x.deflected)
              if (hit && !S.current.over) {
                // SPLAT — it landed on you
                const move = enemy.moves[Math.floor(Math.random() * enemy.moves.length)]
                const tierScale = ENEMY_DMG_SCALE[enemy.tier as keyof typeof ENEMY_DMG_SCALE] ?? 0.4
                const dmg = Math.max(1, Math.floor(move.damage * (0.7 + Math.random() * 0.6) * tierScale * diffRef.current.foeDmgMult))
                S.current.playerHp = Math.max(0, S.current.playerHp - dmg)
                setPlayerHp(S.current.playerHp)
                setSplat({ color: theme.splat, emoji: theme.emoji })
                setTimeout(() => setSplat(null), 900)
                addDmg(dmg, false, '#ef4444', 50)
                setDialogLine(`${theme.label} got you! (−${dmg})`)
                shake()
                sfx.kick()
                buzz([40, 30, 40])
                if (S.current.playerHp <= 0) {
                  S.current.over = true
                  setDialogLine(`${enemy.name} wins this round...`)
                  recordBattle('defeat', 0, movesUsed).then(() => {
                    setPhase('defeat')
                    sfx.defeat()
                  })
                }
              }
              return p.filter(x => x.id !== id)
            })
          }, dur)
        }, 380)
      }
    }, 250)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enemy, phase])

  function deflect(id: number) {
    setProjectiles(p => p.map(x => x.id === id ? { ...x, deflected: true } : x))
    setDialogLine('Swatted it away! 💪')
    sfx.block()
    buzz(15)
    setTimeout(() => setProjectiles(p => p.filter(x => x.id !== id)), 460)
  }

  // ── Input: TAP = rock, SWIPE up = firecracker (limited by level) ───────────
  function onPointerDown(e: React.PointerEvent) {
    if (phase !== 'fighting' || !arenaRef.current) return
    const rect = arenaRef.current.getBoundingClientRect()
    S.current.swipe = { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() }
  }
  function onPointerUp(e: React.PointerEvent) {
    const sw = S.current.swipe
    S.current.swipe = null
    if (!sw || phase !== 'fighting' || !arenaRef.current) return
    const rect = arenaRef.current.getBoundingClientRect()
    const x1 = e.clientX - rect.left
    const y1 = e.clientY - rect.top
    const dist = Math.hypot(x1 - sw.x, y1 - sw.y)
    const isSwipe = dist > 26 && (y1 - sw.y) < -18 // meaningful upward drag

    if (isSwipe) {
      // Firecracker — bigger hit, but rationed by level
      if (S.current.fcLeft <= 0) {
        setDialogLine('🧨 Out of firecrackers! Tap to keep throwing rocks.')
        launchThrow(sw.x, sw.y, x1, y1, 'rock')
        return
      }
      S.current.fcLeft--
      setFcLeft(S.current.fcLeft)
      launchThrow(sw.x, sw.y, x1, y1, 'firecracker')
    } else {
      // Tap — rock, straight at the sprite
      launchThrow(sw.x, sw.y, x1, y1, 'rock')
    }
  }

  // ── API ────────────────────────────────────────────────────────────────────
  async function recordBattle(result: string, fpCost: number, moves: any[]) {
    if (!enemy || !profile) return null
    try {
      const res = await fetch('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enemy_id: enemy.id, result, fp_spent: fpCost, moves_used: moves,
          duration_secs: Math.floor((Date.now() - startTime.current) / 1000),
        }),
      })
      const data = await res.json()
      await refetch()
      return data
    } catch { return null }
  }

  async function flee() {
    if (!enemy) return
    await recordBattle('fled', 0, movesUsed)
    router.push('/map')
  }

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!enemy || !profile) {
    return (
      <div style={{ minHeight: '100vh', background: '#050a14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 14 }}>Loading battle...</span>
      </div>
    )
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const partyColor = profile.party === 'democrat' ? '#2563eb' : '#dc2626'
  const tierColor = enemy.tier === 'legendary' ? '#f59e0b' : enemy.tier === 'rare' ? '#a78bfa' : '#9ca3af'
  const enemyLevel = TIER_LEVELS[enemy.tier as keyof typeof TIER_LEVELS]
  const enemyTint = enemy.party === 'democrat' ? ['#60a5fa', '#2563eb'] : ['#f87171', '#dc2626']
  const ouchSrc = enemy.image.replace('.png', '_ouch.png')
  const throwSrc = enemy.image.replace('.png', '_throw.png')
  // Sprites with a _throw frame constantly cock-and-throw; a hit briefly
  // holds the release (follow-through) pose
  const hasThrow = !throwGone

  const animDefs = {
    idle:   { css: 'pokeIdle',  dur: 2400, iter: 'infinite', fill: 'none' },
    lowHp:  { css: 'pokeLowHp', dur: 900,  iter: 'infinite', fill: 'none' },
    hit:    { css: 'pokeHit',   dur: 500,  iter: '1', fill: 'none' },
    charge: { css: 'pokeChrg',  dur: 380,  iter: '1', fill: 'none' },
    faint:  { css: 'pokeFaint', dur: 900,  iter: '1', fill: 'forwards' },
  }
  const anim = animDefs[spriteAnim]

  return (
    <div
      ref={arenaRef}
      style={{
        height: '100dvh', minHeight: '100vh', position: 'relative', overflow: 'hidden',
        userSelect: 'none',
        background: 'linear-gradient(180deg, #060d1a 0%, #0c1533 30%, #12224a 48%, #1a2a3a 60%, #1c2e1a 74%, #243320 90%, #141f12 100%)',
        touchAction: phase === 'fighting' ? 'none' : 'auto',
        animation: screenShake ? 'screenShake 0.45s ease-in-out' : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="battle-wipe" />

      {/* Starfield */}
      {[...Array(18)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: i % 3 === 0 ? 2 : 1, height: i % 3 === 0 ? 2 : 1,
          borderRadius: '50%', background: 'white',
          opacity: 0.35 + (i % 4) * 0.15,
          top: `${5 + (i * 13) % 42}%`,
          left: `${(i * 17 + 7) % 100}%`,
          animation: `starTwinkle ${2 + i % 3}s ease-in-out ${(i * 0.3) % 2}s infinite`,
        }} />
      ))}

      {/* Horizon glow + vignette */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(0deg, rgba(30,60,20,0.6) 0%, transparent 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 90% 75% at 50% 45%, transparent 55%, rgba(4,8,16,0.6) 100%)', pointerEvents: 'none' }} />

      {/* ── Enemy status (top-left) ─────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 14, left: 12, zIndex: 10,
        background: 'rgba(8,12,22,0.92)', border: '2px solid rgba(255,255,255,0.16)',
        borderRadius: 14, padding: '8px 12px', minWidth: 170,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>{enemy.name}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, border: `1px solid ${tierColor}`, color: tierColor }}>
            Lv.{enemyLevel}
          </span>
        </div>
        <HpBar current={enemyHp} max={maxHp} />
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: `${tierColor}22`, color: tierColor, border: `1px solid ${tierColor}44`, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {enemy.tier}
          </span>
        </div>
      </div>

      {/* ── Flee ────────────────────────────────────────────────────────────── */}
      {phase === 'fighting' && (
        <button
          onClick={(e) => { e.stopPropagation(); flee() }}
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: 14, right: 12, zIndex: 10,
            background: 'rgba(8,12,22,0.85)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 10, padding: '7px 12px',
            color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
          🏃 Flee
        </button>
      )}

      {/* ── The sprite — smaller, juking in all directions ──────────────────── */}
      <div style={{
        position: 'absolute', top: '15%', left: `${enemyX}%`, zIndex: 5,
        transform: `translateX(-50%) translateY(${enemyY}px)`,
        transition: `left ${S.current.exDur}ms ease-out, transform ${S.current.exDur}ms ease-out`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
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

        {ENEMY_3D[enemy.id] ? (
          <div style={{
            width: 'min(62vw, 320px)', aspectRatio: '1 / 1', position: 'relative',
            animation: `${anim.css} ${anim.dur}ms ease-in-out ${anim.iter} ${anim.fill}`,
            transformOrigin: 'bottom center',
          }}>
            {/* 2D sprite shows instantly; the 3D model fades in once it loads */}
            {!enemy3dReady && (
              <img src={enemy.image} alt={enemy.name} style={{
                position: 'absolute', inset: 0, margin: 'auto', width: '58%', height: 'auto',
                objectFit: 'contain', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.5))',
              }} />
            )}
            <Enemy3D prefix={ENEMY_3D[enemy.id]} attackKey={spriteAnim === 'charge' ? spriteKey : 0}
              onReady={() => setEnemy3dReady(true)} />
          </div>
        ) : (
        <div
          key={spriteKey}
          style={{
            width: 'min(30vw, 130px)',
            aspectRatio: '3 / 4.2',
            position: 'relative',
            animation: `${anim.css} ${anim.dur}ms ease-in-out ${anim.iter} ${anim.fill}`,
            transformOrigin: 'bottom center',
          }}
        >
          <div style={{
            position: 'absolute', inset: '8%', borderRadius: '50%',
            background: `radial-gradient(ellipse 60% 60% at 50% 55%, ${enemyTint[0]}40 0%, ${enemyTint[1]}18 48%, transparent 72%)`,
            filter: 'blur(4px)',
          }} />
          {hasThrow && !(ouch && !ouchMissing.current) ? (
            // Two-frame cock-and-throw crossfade
            <>
              <img src={enemy.image} alt={enemy.name} draggable={false}
                style={{
                  width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', inset: 0,
                  animation: 'throwCycleA 1150ms ease-in-out infinite',
                  filter: `drop-shadow(0 0 14px ${enemyTint[1]}55) drop-shadow(0 8px 10px rgba(0,0,0,0.55))`,
                }} />
              <img src={throwSrc} alt="" draggable={false}
                onError={() => setThrowGone(true)}
                style={{
                  width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', inset: 0,
                  animation: 'throwCycleB 1150ms ease-in-out infinite',
                  filter: `drop-shadow(0 0 14px ${enemyTint[1]}55) drop-shadow(0 8px 10px rgba(0,0,0,0.55))`,
                }} />
            </>
          ) : (
            <img
              src={ouch && !ouchMissing.current ? ouchSrc : enemy.image}
              alt={enemy.name}
              draggable={false}
              onError={() => { ouchMissing.current = true; setOuch(false) }}
              style={{
                width: '100%', height: '100%', objectFit: 'contain', display: 'block', position: 'relative',
                filter: `drop-shadow(0 0 14px ${enemyTint[1]}55) drop-shadow(0 8px 10px rgba(0,0,0,0.55))`,
              }}
            />
          )}
          {ouch && (
            <div style={{
              position: 'absolute', top: '-4%', right: '-6%',
              fontSize: 26, fontWeight: 900, color: '#fde047',
              textShadow: '0 2px 4px rgba(0,0,0,0.8)', transform: 'rotate(12deg)',
            }}>💥OUCH!</div>
          )}
        </div>
        )}
        <div style={{ width: '38%', height: 16, background: 'radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, transparent 70%)', borderRadius: '50%', marginTop: '-8%', filter: 'blur(5px)' }} />
      </div>

      {/* miss marker */}
      {missAt && (
        <div style={{
          position: 'absolute', top: '26%', left: `${missAt.xPct}%`, zIndex: 20,
          transform: 'translateX(-50%)', pointerEvents: 'none',
          fontSize: 16, fontWeight: 900, color: '#9ca3af',
          textShadow: '0 2px 4px rgba(0,0,0,0.8)',
          animation: 'dmgFloat 0.8s ease-out forwards',
        }}>MISS</div>
      )}

      {/* flying projectiles */}
      {projectiles.map(p => (
        <Missile key={p.id} p={p} onDeflect={deflect} />
      ))}

      {/* splat overlay when their junk lands on you */}
      {splat && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', bottom: '-12%', left: '50%', transform: 'translateX(-50%)',
            width: '130%', height: '55%', borderRadius: '50%',
            background: `radial-gradient(ellipse at 50% 100%, ${splat.color} 0%, transparent 70%)`,
            animation: 'splatFade 0.9s ease-out forwards',
          }} />
          <div style={{
            position: 'absolute', bottom: '18%', left: '50%', transform: 'translateX(-50%)',
            fontSize: 64, animation: 'boomPop 0.7s ease-out forwards',
          }}>{splat.emoji}</div>
        </div>
      )}

      {/* player damage numbers (center-low) */}
      {dmgNums.filter(d => !d.onEnemy).map(d => (
        <div key={d.id} style={{
          position: 'absolute', bottom: '30%', left: '50%',
          fontSize: 26, fontWeight: 900, color: d.color,
          textShadow: `0 0 10px ${d.color}`,
          animation: 'dmgFloat 1s ease-out forwards', zIndex: 20, whiteSpace: 'nowrap',
        }}>−{d.val}</div>
      ))}

      {/* ── Player HP (bottom bar, compact) ─────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 96, left: 12, right: 12, zIndex: 10,
        background: 'rgba(8,12,22,0.92)', border: '2px solid rgba(255,255,255,0.16)',
        borderRadius: 14, padding: '8px 12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ color: 'white', fontWeight: 800, fontSize: 13 }}>{profile.username}</span>
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
          textAlign: 'center',
          padding: '8px 12px calc(12px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(0deg, rgba(4,8,14,0.9) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700 }}>
            👆 TAP = 🪨 rock · ☝️ SWIPE up = 🧨 {fcLeft} left · TAP their {(FOE_THROWS[enemy.id] ?? DEFAULT_FOE_THROW).emoji} to swat
          </span>
        </div>
      )}

      {/* VICTORY overlay */}
      {phase === 'victory' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(4,8,16,0.78)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 44 }}>🎯</div>
              <h2 style={{ color: 'white', fontWeight: 900, fontSize: 24, margin: '4px 0' }}>
                {captured ? `${enemy.name} Captured!` : 'Victory!'}
              </h2>
              <p style={{ color: '#4ade80', fontSize: 14, fontWeight: 700, margin: 0 }}>+{fpEarned} FP earned!</p>
            </div>
            <div style={{
              background: `${tierColor}11`, border: `2px solid ${tierColor}44`, borderRadius: 14,
              padding: '14px', textAlign: 'center',
            }}>
              <img src={enemy.image} alt={enemy.name}
                style={{ width: 110, height: 110, objectFit: 'contain', filter: `drop-shadow(0 0 14px ${tierColor}66)` }} />
              <p style={{ color: 'white', fontWeight: 800, fontSize: 14, margin: '6px 0 0' }}>
                {captured ? '📦 Added to your collection' : 'Defeated!'}
              </p>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: '2px 0 0' }}>
                Duplicates sell back for FP in your Collection
              </p>
            </div>
            <button onClick={() => router.push('/map')}
              style={{ padding: '14px 0', background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)`, border: 'none', borderRadius: 12, color: 'white', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>
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
              {enemy.name}&apos;s {(FOE_THROWS[enemy.id] ?? DEFAULT_FOE_THROW).label} was too much!
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

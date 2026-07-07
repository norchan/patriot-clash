'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { getEnemyById, getRandomEnemy } from '@/config/enemies'
import type { Enemy } from '@/config/enemies'

import { ATTACKS, TIER_DEFENSE } from '@/config/attacks'
import type { GestureType } from '@/config/attacks'

const CAPTURE_RATES = { common: 0.75, rare: 0.40, legendary: 0.15 }
const CAPTURE_COSTS = { common: 15, rare: 30, legendary: 75 }

const PLAYER_MAX_HP = 150

// Enemy counterattack tuning. Raw move damage (18-100) vs 150 player HP would
// make even commons near-unwinnable, so counters are scaled per tier and can
// miss. Targets: commons easy (~10/turn), rares moderate (~17), legendaries
// an RNG-tight epic (~24).
const ENEMY_DMG_SCALE = { common: 0.32, rare: 0.45, legendary: 0.4 }
const ENEMY_MISS_CHANCE = 0.18

const TYPE_COLORS: Record<string, string> = {
  Normal: '#a8a878', Fire: '#f08030', Electric: '#f8d030', Guard: '#6890f0',
}

const TIER_LEVELS = { common: 12, rare: 35, legendary: 70 }

function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }
function canAfford(cost: number, fp: number) { return fp >= cost }

// ─────────────────────────────────────────────────────────────────────────────
// Pokémon-style HP bar
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Main battle content
// ─────────────────────────────────────────────────────────────────────────────
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
  const [fpSpent, setFpSpent] = useState(0)
  const [movesUsed, setMovesUsed] = useState<any[]>([])
  const [battleId, setBattleId] = useState<string | null>(null)
  const [isDefending, setIsDefending] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  // Sprite animation — increment spriteKey to force CSS restart
  const [spriteKey, setSpriteKey] = useState(0)
  const [spriteAnim, setSpriteAnim] = useState<'idle' | 'lowHp' | 'hit' | 'attack' | 'charge' | 'faint'>('idle')
  const [videoFailed, setVideoFailed] = useState(false)

  // Visual effects
  const [screenShake, setScreenShake] = useState(false)
  const [flashOverlay, setFlashOverlay] = useState('')
  const [dmgNums, setDmgNums] = useState<{ id: number; val: number; isPlayer: boolean; color: string }[]>([])
  const [lastMove, setLastMove] = useState<{ name: string; type: string } | null>(null)
  const [dialogLine, setDialogLine] = useState('')

  // Capture
  const [alreadyCaptured, setAlreadyCaptured] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureResult, setCaptureResult] = useState<'success' | 'failed' | null>(null)

  // Touch gesture refs
  const touchRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null)
  const holdFiredRef = useRef(false)
  const dmgCounter = useRef(0)
  const startTime = useRef(Date.now())

  // ── Inject battle keyframe styles into <head> (more reliable than <style> in body) ──
  useEffect(() => {
    if (document.getElementById('battle-kf')) return
    const s = document.createElement('style')
    s.id = 'battle-kf'
    s.textContent = `
      /* Idle: 20px bob with slight rotation to feel alive */
      @keyframes pokeIdle {
        0%,100% { transform: translateY(0px) rotate(0deg); }
        25%      { transform: translateY(-18px) rotate(-2deg); }
        75%      { transform: translateY(-8px) rotate(1.5deg); }
      }
      /* Low HP: frantic wobble */
      @keyframes pokeLowHp {
        0%,100% { transform: translateY(0) rotate(-6deg) scale(0.96); }
        25%     { transform: translateY(-10px) rotate(6deg) scale(1.02); }
        75%     { transform: translateY(-5px) rotate(-3deg) scale(0.98); }
      }
      /* Hit: triple white flash — the classic Pokémon hit */
      @keyframes pokeHit {
        0%   { filter: none;                         transform: translateX(0); }
        12%  { filter: brightness(300) saturate(0);  transform: translateX(18px); }
        24%  { filter: none;                         transform: translateX(-14px); }
        42%  { filter: brightness(300) saturate(0);  transform: translateX(10px); }
        60%  { filter: none;                         transform: translateX(-6px); }
        78%  { filter: brightness(300) saturate(0); }
        100% { filter: none;                         transform: translateX(0); }
      }
      /* Charge: pulse and glow before lunging */
      @keyframes pokeChrg {
        0%,100% { transform: scale(1); filter: brightness(1); }
        50%      { transform: scale(1.15); filter: brightness(2.5) saturate(2); }
      }
      /* Attack: dramatic lunge across the arena toward the player */
      @keyframes pokeAtk {
        0%   { transform: translate(0px, 0px) scale(1); }
        30%  { transform: translate(-220px, 90px) scale(1.35); }
        60%  { transform: translate(-220px, 90px) scale(1.35); }
        100% { transform: translate(0px, 0px) scale(1); }
      }
      /* Faint: fall and disappear */
      @keyframes pokeFaint {
        0%   { transform: translateY(0px) rotate(0deg); opacity: 1; }
        20%  { transform: translateY(30px) rotate(15deg); opacity: 0.8; }
        100% { transform: translateY(200px) rotate(40deg); opacity: 0; }
      }
      /* Screen shake */
      @keyframes screenShake {
        0%,100% { transform: translate(0,0); }
        15%     { transform: translate(-12px,-5px) rotate(-1deg); }
        30%     { transform: translate(12px,5px) rotate(1deg); }
        50%     { transform: translate(-7px,-3px); }
        70%     { transform: translate(7px,3px); }
        85%     { transform: translate(-3px,0); }
      }
      @keyframes flashFade  { 0%{opacity:1} 100%{opacity:0} }
      @keyframes dmgFloat   { 0%{transform:translateX(-50%) translateY(0);opacity:1} 100%{transform:translateX(-50%) translateY(-65px);opacity:0} }
      @keyframes starTwinkle{ 0%,100%{opacity:0.3} 50%{opacity:0.9} }
      button:active:not(:disabled){ transform:scale(0.93) }
    `
    document.head.appendChild(s)
    return () => { document.getElementById('battle-kf')?.remove() }
  }, [])

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return
    const opponentParty = profile.party === 'republican' ? 'democrat' : 'republican'
    const e = enemyId ? getEnemyById(enemyId) : getRandomEnemy(opponentParty)
    if (e) {
      setEnemy(e)
      setEnemyHp(e.hp)
      setMaxHp(e.hp)
      setVideoFailed(false)
      setDialogLine(`A wild ${e.name} appeared!`)
    }
  }, [enemyId, profile])

  useEffect(() => {
    if (!enemy || !profile) return
    fetch(`/api/collection/check?enemy_id=${enemy.id}`)
      .then(r => r.json())
      .then(d => setAlreadyCaptured(d.captured))
      .catch(() => {})
  }, [enemy, profile])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function addDmg(val: number, isPlayer: boolean, color: string) {
    const id = ++dmgCounter.current
    setDmgNums(p => [...p, { id, val, isPlayer, color }])
    setTimeout(() => setDmgNums(p => p.filter(d => d.id !== id)), 1000)
  }

  function playAnim(name: typeof spriteAnim) {
    setSpriteAnim(name)
    setSpriteKey(k => k + 1)
  }

  function shake() {
    setScreenShake(true)
    setTimeout(() => setScreenShake(false), 500)
  }

  function flash(color: string, ms = 350) {
    setFlashOverlay(color)
    setTimeout(() => setFlashOverlay(''), ms)
  }

  // ── Attack handler ────────────────────────────────────────────────────────
  async function handleAttack(gesture: GestureType) {
    if (!enemy || !profile || isAnimating || phase !== 'fighting') return

    const atk = ATTACKS[gesture]
    const fp = profile.fp_balance - fpSpent
    if (fp < atk.fp) {
      setDialogLine(`Need ${atk.fp} FP for ${atk.name}!`)
      return
    }

    setIsAnimating(true)
    setLastMove({ name: atk.name, type: atk.type })
    setFpSpent(p => p + atk.fp)

    // Locals instead of state reads: state set above is stale inside this
    // closure, which previously made Shield Block never block the counterattack
    // and recorded only the final move's FP as spent.
    const defending = gesture === 'hold'
    const totalFpSpent = fpSpent + atk.fp
    let moveRecord: { name: string; power: number; damage: number } | null = null
    let enemyHpAfter = enemyHp

    if (defending) {
      setIsDefending(true)
      setDialogLine(`${profile.username} used Shield Block!`)
      flash('#3b82f666', 500)
      // Shield moves are recorded too — the server recomputes FP cost from
      // moves_used, so unrecorded moves would be free
      moveRecord = { name: atk.name, power: 0, damage: 0 }
      setMovesUsed(p => [...p, moveRecord!])
      await wait(600)
    } else {
      setDialogLine(`${profile.username} used ${atk.name}!`)
      flash(`${atk.color}44`, 200)
      await wait(180)

      const mult = TIER_DEFENSE[enemy.tier as keyof typeof TIER_DEFENSE]
      const dmg = Math.floor(atk.damage * (0.8 + Math.random() * 0.4) * mult)
      const newHp = Math.max(0, enemyHp - dmg)
      enemyHpAfter = newHp

      playAnim('hit')
      addDmg(dmg, false, atk.color)
      setEnemyHp(newHp)

      moveRecord = { name: atk.name, power: atk.damage, damage: dmg }
      setMovesUsed(p => [...p, moveRecord!])

      await wait(600)

      if (newHp <= 0) {
        playAnim('faint')
        setDialogLine(`${enemy.name} fainted!`)
        await wait(900)
        const result = await recordBattle('victory', totalFpSpent, [...movesUsed, moveRecord])
        if (result?.battle_id) setBattleId(result.battle_id)
        if (spawnId) {
          try { localStorage.setItem(`spawn_dead_${spawnId}`, Date.now().toString()) } catch {}
        }
        setPhase('victory')
        setIsAnimating(false)
        return
      }

      // Wobble frantically once the ENEMY is low, not the player
      playAnim(newHp <= maxHp * 0.25 ? 'lowHp' : 'idle')
    }

    // ── Enemy counterattack ─────────────────────────────────────────────────
    await wait(250)
    const move = enemy.moves[Math.floor(Math.random() * enemy.moves.length)]
    setDialogLine(`${enemy.name} used ${move.name}!`)

    playAnim('charge')
    await wait(400)
    playAnim('attack')
    await wait(350)

    const missed = Math.random() < ENEMY_MISS_CHANCE
    const tierScale = ENEMY_DMG_SCALE[enemy.tier as keyof typeof ENEMY_DMG_SCALE] ?? 0.4
    const baseDmg = Math.max(1, Math.floor(move.damage * (0.7 + Math.random() * 0.6) * tierScale))
    const actualDmg = missed ? 0 : defending ? Math.floor(baseDmg * 0.4) : baseDmg
    const newPlayerHp = Math.max(0, playerHp - actualDmg)

    if (missed) {
      setDialogLine(`${enemy.name} used ${move.name}... but missed!`)
    } else {
      shake()
      flash('#ef444455', 400)
      addDmg(actualDmg, true, '#ef4444')
      setPlayerHp(newPlayerHp)
      setDialogLine(defending
        ? `${enemy.name} used ${move.name}! Blocked! (-${actualDmg})`
        : `${enemy.name} used ${move.name}! (-${actualDmg})`
      )
    }

    await wait(500)
    if (defending) setIsDefending(false)
    playAnim(enemyHpAfter <= maxHp * 0.25 ? 'lowHp' : 'idle')

    if (newPlayerHp <= 0) {
      setDialogLine(`${profile.username} was defeated...`)
      await recordBattle('defeat', totalFpSpent, moveRecord ? [...movesUsed, moveRecord] : movesUsed)
      setPhase('defeat')
    }

    setIsAnimating(false)
  }

  // ── Touch gestures ────────────────────────────────────────────────────────
  function onTouchStart(e: React.TouchEvent) {
    if (phase !== 'fighting') return
    // Gestures live on the whole screen now — ignore touches on real controls
    if ((e.target as HTMLElement).closest?.('button')) return
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    holdFiredRef.current = false
    holdTimerRef.current = setTimeout(() => {
      holdFiredRef.current = true
      handleAttack('hold')
    }, 550)
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    if ((e.target as HTMLElement).closest?.('button')) { touchRef.current = null; return }
    if (!touchRef.current || holdFiredRef.current) { touchRef.current = null; return }
    const t = e.changedTouches[0]
    const dx = t.clientX - touchRef.current.x
    const dy = t.clientY - touchRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const ms = Date.now() - touchRef.current.time
    touchRef.current = null
    if (dist < 18 && ms < 300) {
      handleAttack('tap')
    } else if (dist > 40) {
      if (dy < -35 && Math.abs(dy) > Math.abs(dx)) handleAttack('swipe-up')
      else if (dx > 40 && Math.abs(dx) > Math.abs(dy)) handleAttack('swipe-right')
    }
  }

  // Keyboard fallback
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (phase !== 'fighting') return
      if (e.key === ' ' || e.key === 'Enter') handleAttack('tap')
      if (e.key === 'ArrowRight' || e.key === 'd') handleAttack('swipe-right')
      if (e.key === 'ArrowUp' || e.key === 'w') handleAttack('swipe-up')
      if (e.key === 's') handleAttack('hold')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [phase, isAnimating, enemyHp, playerHp, fpSpent, isDefending, movesUsed, enemy, profile])

  // ── API ───────────────────────────────────────────────────────────────────
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
      // The refetched balance already reflects the server-side debit — reset
      // the local counter so fpAvail doesn't subtract the battle cost twice
      setFpSpent(0)
      return data
    } catch { return null }
  }

  async function attemptCapture() {
    if (!enemy || !profile || capturing) return
    const cost = CAPTURE_COSTS[enemy.tier]
    if ((profile.fp_balance - fpSpent) < cost) {
      setDialogLine(`Need ${cost} FP to capture!`)
      return
    }
    setCapturing(true)
    try {
      const res = await fetch('/api/collection/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enemy_id: enemy.id, battle_id: battleId }),
      })
      const data = await res.json()
      setCaptureResult(data.captured ? 'success' : 'failed')
      setDialogLine(data.captured ? `${enemy.name} was captured!` : `${enemy.name} broke free!`)
      await refetch()
    } catch { setCaptureResult('failed') }
    finally { setCapturing(false) }
  }

  async function flee() {
    if (!enemy) return
    // Fleeing still pays for the moves already used this battle
    await recordBattle('fled', fpSpent, movesUsed)
    router.push('/map')
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!enemy || !profile) {
    return (
      <div style={{ minHeight: '100vh', background: '#050a14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 14 }}>Loading battle...</span>
      </div>
    )
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const fpAvail = profile.fp_balance - fpSpent
  const partyColor = profile.party === 'democrat' ? '#2563eb' : '#dc2626'
  const tierColor = enemy.tier === 'legendary' ? '#f59e0b' : enemy.tier === 'rare' ? '#a78bfa' : '#9ca3af'
  const enemyLevel = TIER_LEVELS[enemy.tier as keyof typeof TIER_LEVELS]
  const playerLevel = Math.min(100, Math.floor(profile.fp_balance / 100) + 5)

  const animDefs = {
    idle:   { css: 'pokeIdle',   dur: 2400, iter: 'infinite', fill: 'none' },
    lowHp:  { css: 'pokeLowHp', dur: 900,  iter: 'infinite', fill: 'none' },
    hit:    { css: 'pokeHit',   dur: 500,  iter: '1', fill: 'none' },
    attack: { css: 'pokeAtk',   dur: 700,  iter: '1', fill: 'none' },
    charge: { css: 'pokeChrg',  dur: 350,  iter: '2', fill: 'none' },
    // forwards: hold the fallen/faded end state so the KO'd enemy doesn't
    // visually resurrect behind the victory panel
    faint:  { css: 'pokeFaint', dur: 900,  iter: '1', fill: 'forwards' },
  }
  const anim = animDefs[spriteAnim]

  // Video clip for the current state; states without a clip fall back to the
  // idle clip (still with the CSS effect layered on top), and enemies with no
  // clips at all fall back to the static image.
  const clips = enemy.animations
  const activeClip = clips
    ? (spriteAnim === 'attack' || spriteAnim === 'charge' ? (clips.attack ?? clips.idle)
      : spriteAnim === 'hit' ? (clips.hit ?? clips.idle)
      : spriteAnim === 'faint' ? (clips.faint ?? clips.idle)
      : clips.idle)
    : undefined
  const clipLoops = spriteAnim === 'idle' || spriteAnim === 'lowHp'

  // ── Render ────────────────────────────────────────────────────────────────
  // One full-screen arena. The entire screen is the gesture zone — tap/swipe/
  // hold anywhere (on the enemy) to attack. No buttons during the fight.
  return (
    <div
      style={{
        height: '100dvh', minHeight: '100vh', position: 'relative', overflow: 'hidden',
        userSelect: 'none',
        background: 'linear-gradient(180deg, #060d1a 0%, #0c1533 30%, #12224a 48%, #1a2a3a 60%, #1c2e1a 74%, #243320 90%, #141f12 100%)',
        touchAction: phase === 'fighting' ? 'none' : 'auto',
        cursor: phase === 'fighting' ? 'pointer' : 'default',
        animation: screenShake ? 'screenShake 0.5s ease-in-out' : 'none',
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClick={() => phase === 'fighting' && !isAnimating && handleAttack('tap')}
    >

      {/* Screen flash */}
      {flashOverlay && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: flashOverlay, animation: 'flashFade 0.35s ease-out', pointerEvents: 'none' }} />
      )}
        {/* Starfield */}
        {[...Array(18)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: i % 3 === 0 ? 2 : 1, height: i % 3 === 0 ? 2 : 1,
            borderRadius: '50%', background: 'white',
            opacity: 0.35 + (i % 4) * 0.15,
            top: `${5 + (i * 13) % 48}%`,
            left: `${(i * 17 + 7) % 100}%`,
            animation: `starTwinkle ${2 + i % 3}s ease-in-out ${(i * 0.3) % 2}s infinite`,
          }} />
        ))}

        {/* Horizon glow */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(0deg, rgba(30,60,20,0.6) 0%, transparent 100%)', pointerEvents: 'none' }} />

        {/* Vignette — darkens the edges so the masked sprite melts into the scene */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 90% 75% at 50% 45%, transparent 55%, rgba(4,8,16,0.6) 100%)', pointerEvents: 'none' }} />

        {/* ── Enemy status box (top-left) ─────────────────────────────────── */}
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
          <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: `${tierColor}22`, color: tierColor, border: `1px solid ${tierColor}44`, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {enemy.tier}
            </span>
          </div>
        </div>

        {/* ── Enemy — full-stage, edge-masked into the background ──────────── */}
        <div style={{ position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 5, pointerEvents: 'none' }}>
          {/* Damage numbers above enemy */}
          {dmgNums.filter(d => !d.isPlayer).map(d => (
            <div key={d.id} style={{
              position: 'absolute', top: '10%', left: '50%',
              transform: 'translateX(-50%)',
              fontSize: d.val >= 50 ? 42 : 32, fontWeight: 900,
              color: d.color, textShadow: `0 0 12px ${d.color}, 0 2px 4px rgba(0,0,0,0.8)`,
              animation: 'dmgFloat 1s ease-out forwards', pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap',
            }}>−{d.val}</div>
          ))}

          {/* Tier aura glow behind the sprite */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '72%', height: '72%', borderRadius: '50%',
            background: `radial-gradient(circle, ${tierColor}30 0%, transparent 68%)`,
            pointerEvents: 'none',
          }} />

          {(() => {
            // No border, no bubble — a soft radial mask dissolves the clip's
            // own background into the arena so the character reads as part of
            // the scene
            const spriteMask = 'radial-gradient(ellipse 62% 62% at 50% 44%, black 45%, rgba(0,0,0,0.5) 62%, transparent 76%)'
            const spriteStyle = {
              width: 'min(94vw, 460px)',
              aspectRatio: '1 / 1',
              objectFit: 'cover' as const,
              maskImage: spriteMask,
              WebkitMaskImage: spriteMask,
              animation: `${anim.css} ${anim.dur}ms ease-in-out ${anim.iter} ${anim.fill}`,
              transformOrigin: 'bottom center' as const,
            }
            return activeClip && !videoFailed ? (
              <video
                key={`${spriteKey}-${activeClip}`}
                src={activeClip}
                poster={enemy.image}
                aria-label={enemy.name}
                autoPlay muted playsInline
                loop={clipLoops}
                onError={() => setVideoFailed(true)}
                style={spriteStyle}
              />
            ) : (
              <img
                key={spriteKey}
                src={enemy.image}
                alt={enemy.name}
                style={{ ...spriteStyle, objectFit: 'contain' }}
              />
            )
          })()}

          {/* Ground shadow */}
          <div style={{ width: '44%', height: 26, background: 'radial-gradient(ellipse, rgba(0,0,0,0.6) 0%, transparent 70%)', borderRadius: '50%', marginTop: '-14%', filter: 'blur(6px)' }} />
        </div>

        {/* ── Player side (lower-left) ─────────────────────────────────────── */}
        <div style={{ position: 'absolute', left: 14, bottom: 118, display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 5, pointerEvents: 'none' }}>
          {/* Player damage numbers */}
          {dmgNums.filter(d => d.isPlayer).map(d => (
            <div key={d.id} style={{
              position: 'absolute', top: -35, left: '50%', transform: 'translateX(-50%)',
              fontSize: 22, fontWeight: 900, color: d.color,
              textShadow: `0 0 10px ${d.color}`,
              animation: 'dmgFloat 1s ease-out forwards', pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap',
            }}>−{d.val}</div>
          ))}

          {/* Player "back sprite" */}
          <div style={{
            width: 88, height: 108,
            background: `linear-gradient(160deg, ${partyColor}44 0%, ${partyColor}18 100%)`,
            border: `2px solid ${partyColor}66`, borderRadius: '44% 44% 32% 32%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 0 18px ${partyColor}44`,
          }}>
            <div style={{ fontSize: 36 }}>{profile.party === 'democrat' ? '🔵' : '🔴'}</div>
            {isDefending && <div style={{ fontSize: 16, marginTop: -4 }}>🛡️</div>}
          </div>

          <div style={{ width: 80, height: 18, background: 'radial-gradient(ellipse, rgba(0,0,0,0.45) 0%, transparent 70%)', borderRadius: '50%', marginTop: -6, filter: 'blur(4px)' }} />
        </div>

        {/* ── Player status box (lower-right) ─────────────────────────────── */}
        <div style={{
          position: 'absolute', bottom: 118, right: 12, zIndex: 10,
          background: 'rgba(8,12,22,0.92)', border: '2px solid rgba(255,255,255,0.16)',
          borderRadius: 14, padding: '8px 12px', minWidth: 170,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <span style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>{profile.username}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, border: `1px solid ${partyColor}`, color: partyColor }}>
              Lv.{playerLevel}
            </span>
          </div>
          <HpBar current={playerHp} max={PLAYER_MAX_HP} />
          <div style={{ marginTop: 5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#facc15', fontSize: 11, fontWeight: 700 }}>⚡ {fpAvail.toLocaleString()}</span>
            {isDefending && <span style={{ fontSize: 10, color: '#60a5fa' }}>🛡️ SHIELD</span>}
          </div>
        </div>
      {/* ── Flee (top-right, only real button on screen) ──────────────────── */}
      {phase === 'fighting' && (
        <button
          onClick={(e) => { e.stopPropagation(); flee() }}
          disabled={isAnimating}
          style={{
            position: 'absolute', top: 14, right: 12, zIndex: 10,
            background: 'rgba(8,12,22,0.85)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 10, padding: '7px 12px',
            color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
          🏃 Flee
        </button>
      )}

      {/* ── Dialog line (floating, above the hint bar) ────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 78, left: 0, right: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '0 16px', pointerEvents: 'none', minHeight: 22,
      }}>
        {lastMove && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
            background: TYPE_COLORS[lastMove.type] + '33', color: TYPE_COLORS[lastMove.type],
            border: `1px solid ${TYPE_COLORS[lastMove.type]}55`,
            textTransform: 'uppercase', flexShrink: 0,
          }}>
            {lastMove.type}
          </span>
        )}
        <span style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: 600, textShadow: '0 2px 8px rgba(0,0,0,0.9)', textAlign: 'center' }}>
          {dialogLine}
        </span>
      </div>

      {/* ── Gesture hints (bottom bar — the screen itself is the controller) ── */}
      {phase === 'fighting' && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          display: 'flex', justifyContent: 'center', gap: 6,
          padding: '10px 10px calc(12px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(0deg, rgba(4,8,14,0.9) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}>
          {(Object.entries(ATTACKS) as [GestureType, typeof ATTACKS[GestureType]][]).map(([g, a]) => {
            const ok = canAfford(a.fp, fpAvail)
            return (
              <div key={g} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                opacity: ok ? 1 : 0.3,
                background: 'rgba(8,12,22,0.7)', border: `1px solid ${a.color}44`,
                borderRadius: 10, padding: '6px 10px', minWidth: 70,
              }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'white', whiteSpace: 'nowrap' }}>{a.emoji} {a.hint}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: a.color, whiteSpace: 'nowrap' }}>{a.name}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#facc15' }}>{a.fp} FP</span>
              </div>
            )
          })}
        </div>
      )}

        {/* VICTORY overlay */}
        {phase === 'victory' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(4,8,16,0.78)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40 }}>🎉</div>
              <h2 style={{ color: 'white', fontWeight: 900, fontSize: 22, margin: '4px 0' }}>Victory!</h2>
              <p style={{ color: '#4ade80', fontSize: 14, fontWeight: 700, margin: 0 }}>+{enemy.fpReward} FP earned!</p>
            </div>

            {!alreadyCaptured && captureResult === null && (
              <div style={{ background: `${tierColor}11`, border: `2px solid ${tierColor}44`, borderRadius: 14, padding: '12px 14px' }}>
                <p style={{ color: 'white', fontWeight: 800, fontSize: 14, margin: '0 0 2px' }}>🎯 Capture {enemy.name}?</p>
                <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 10px' }}>
                  {Math.round(CAPTURE_RATES[enemy.tier] * 100)}% success · {CAPTURE_COSTS[enemy.tier]} FP
                </p>
                <button onClick={attemptCapture} disabled={capturing || !canAfford(CAPTURE_COSTS[enemy.tier], fpAvail)}
                  style={{
                    width: '100%', padding: '10px 0',
                    background: canAfford(CAPTURE_COSTS[enemy.tier], fpAvail) ? `linear-gradient(135deg, ${tierColor}, ${tierColor}bb)` : '#1f2937',
                    border: 'none', borderRadius: 10,
                    color: canAfford(CAPTURE_COSTS[enemy.tier], fpAvail) ? '#000' : '#6b7280',
                    fontWeight: 800, fontSize: 14, cursor: 'pointer',
                  }}>
                  {capturing ? '⏳ Throwing...' : `🎯 Capture! (−${CAPTURE_COSTS[enemy.tier]} FP)`}
                </button>
              </div>
            )}
            {captureResult === 'success' && (
              <div style={{ background: '#14532d44', border: '2px solid #16a34a', borderRadius: 12, padding: '10px 14px', textAlign: 'center' }}>
                <p style={{ color: '#4ade80', fontWeight: 800, fontSize: 14, margin: 0 }}>🎯 {enemy.name} captured!</p>
              </div>
            )}
            {captureResult === 'failed' && (
              <div style={{ background: '#450a0a44', border: '2px solid #dc2626', borderRadius: 12, padding: '10px 14px', textAlign: 'center' }}>
                <p style={{ color: '#f87171', fontWeight: 800, fontSize: 14, margin: 0 }}>💨 {enemy.name} broke free!</p>
              </div>
            )}
            {alreadyCaptured && (
              <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 12, padding: '10px 14px', textAlign: 'center' }}>
                <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>✅ Already in your collection</p>
              </div>
            )}
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
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 12px', textAlign: 'center' }}>{enemy.name} was too strong!</p>
            <button onClick={() => router.push('/map')}
              style={{ width: '100%', padding: '12px 0', background: '#1f2937', border: '1px solid #374151', borderRadius: 12, color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              Back to Map
            </button>
            <button onClick={() => router.push('/shop')}
              style={{ width: '100%', padding: '12px 0', background: 'linear-gradient(135deg, #d97706, #f59e0b)', border: 'none', borderRadius: 12, color: '#000', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
              ⚡ Get More FP
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

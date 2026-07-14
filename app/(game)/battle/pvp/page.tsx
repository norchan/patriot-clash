'use client'
import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { type FighterPose } from '@/components/FighterRig'
import FighterSprite from '@/components/FighterSprite'
import { defaultFighter, sanitizeFighter, fighterStats } from '@/lib/fighter'
import type { FighterDesign } from '@/lib/fighter'
import { MOVES, movesForLevel, strikeDamage, type Move } from '@/lib/pvp'
import { sfx, buzz } from '@/lib/juice'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'
import dynamic from 'next/dynamic'

const PvpArena3D = dynamic(() => import('@/components/PvpArena3D'), { ssr: false })

// Positional combat: a strike only lands when the fighters are within range.
const STRIKE_RANGE = 1.05   // world units between the two fighters
const FOE_STEP = 0.05       // opponent approach speed per AI tick (~90ms)
const dist = (a: number, b: number) => Math.abs(a - b)

// ── Types matching lib/pvp.ts FightLog v2 ───────────────────────────────────
interface FightEvent {
  t: number
  attacker: 'c' | 'd'
  move: 'jab' | 'cross' | 'hook' | 'kick' | 'jumpkick' | 'uppercut' | 'special'
  result: 'hit' | 'blocked' | 'dodged'
  dmg: number
  chp: number
  dhp: number
  comboIndex: number
  comboLen: number
}

interface FightLog {
  version: 2
  duration: 30
  events: FightEvent[]
  winner: 'c' | 'd'
  endedBy: 'ko' | 'bell'
  endT: number
  cLevel: number
  dLevel: number
  cFighter: FighterDesign
  dFighter: FighterDesign
}

interface ChallengeData {
  id: string
  status: string
  challenger_id: string
  defender_id: string
  winner_id: string
  fp_stake: number
  battle_log: (FightLog & { version: number; mode?: string; chp?: number; dhp?: number }) | null
  challenger_username: string
  defender_username: string
  challenger_party: 'democrat' | 'republican'
  defender_party: 'democrat' | 'republican'
  challenger_hp_remaining: number | null
  defender_hp_remaining: number | null
  // present while status === 'accepted' (armed live fight)
  challenger_level?: number
  defender_level?: number
  challenger_fighter?: FighterDesign
  defender_fighter?: FighterDesign
  challenger_is_bot?: boolean
  defender_is_bot?: boolean
  challenger_pvp_fighter?: string
  defender_pvp_fighter?: string
}

interface ChatMessage { id: string; sender_id: string; content: string; created_at: string }

const MOVE_LABELS: Record<string, string> = {
  jab: 'JAB', cross: 'CROSS', hook: 'HOOK', uppercut: 'UPPERCUT', kick: 'KICK',
  jumpkick: 'JUMP KICK', special: '★ SPECIAL ★',
}
const MOVE_POSE: Record<string, FighterPose> = {
  jab: 'jab', cross: 'cross', hook: 'hook', uppercut: 'uppercut', kick: 'kick',
  jumpkick: 'jumpkick', special: 'special',
}

function StreetFightPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const challengeId = searchParams.get('id')
  const { profile, loading: profileLoading } = useProfile()

  const [challenge, setChallenge] = useState<ChallengeData | null>(null)
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'intro' | 'fighting' | 'live' | 'done' | 'aborted'>('loading')

  // Fight presentation state
  const [myPose, setMyPose] = useState<FighterPose>('idle')
  const [foePose, setFoePose] = useState<FighterPose>('idle')
  const [myAttacking, setMyAttacking] = useState(false)
  const [foeAttacking, setFoeAttacking] = useState(false)
  // 3D arena: bump a key on each attack's rising edge → plays the punch clip
  // Boxing: only jabs. right/left jab + hit-reaction 3D triggers.
  const [playerJabRKey, setPlayerJabRKey] = useState(0)
  const [playerJabLKey, setPlayerJabLKey] = useState(0)
  const [oppJabRKey, setOppJabRKey] = useState(0)
  const [oppJabLKey, setOppJabLKey] = useState(0)
  const [playerHitKey, setPlayerHitKey] = useState(0)
  const [oppHitKey, setOppHitKey] = useState(0)
  const myJab = (right: boolean) => right ? setPlayerJabRKey(k => k + 1) : setPlayerJabLKey(k => k + 1)
  const foeJab = (right: boolean) => right ? setOppJabRKey(k => k + 1) : setOppJabLKey(k => k + 1)
  // D-pad movement for the 3D player fighter
  const [playerX, setPlayerX] = useState(-1)     // position along the fight line
  const [playerY, setPlayerY] = useState(0)       // jump height
  const [playerDuck, setPlayerDuck] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [oppX, setOppX] = useState(1)              // opponent position (AI-driven)
  const jumpingRef = useRef(false)
  const doJump = useCallback(() => {
    if (jumpingRef.current) return
    jumpingRef.current = true
    const start = performance.now()
    const tick = () => {
      const p = (performance.now() - start) / 520
      if (p >= 1) { setPlayerY(0); jumpingRef.current = false; return }
      setPlayerY(Math.sin(p * Math.PI) * 0.9)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [])
  // Mirror positional/guard state into the fight-loop ref so the realtime AI
  // logic can read fresh values. Contact-based combat: a hit only lands when
  // the two fighters are within STRIKE_RANGE.
  useEffect(() => {
    L.current.playerX = playerX
    // human PvP: share my position (channelRef is only set in realtime fights)
    channelRef.current?.send({ type: 'broadcast', event: 'pos', payload: { x: playerX } })
  }, [playerX])
  useEffect(() => { L.current.oppX = oppX }, [oppX])
  useEffect(() => { L.current.blocking = blocking }, [blocking])
  useEffect(() => { L.current.ducking = playerDuck }, [playerDuck])
  useEffect(() => { L.current.airborne = playerY > 0.25 }, [playerY])
  useEffect(() => { if (phase === 'live') { setPlayerX(-1); setOppX(1); L.current.playerX = -1; L.current.oppX = 1 } }, [phase])
  // Landscape brawler: nudge the phone sideways (and best-effort lock)
  const [landscape, setLandscape] = useState(true)
  useEffect(() => {
    const check = () => setLandscape(window.innerWidth >= window.innerHeight)
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    try { (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}) } catch {}
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check) }
  }, [])
  const [myHp, setMyHp] = useState(100)
  const [foeHp, setFoeHp] = useState(100)
  const [clock, setClock] = useState(30)
  const [moveText, setMoveText] = useState('')
  const [comboText, setComboText] = useState('')
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number; text: string; color: string }[]>([])
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; dx: number; dy: number; color: string; size: number }[]>([])
  const [myReeling, setMyReeling] = useState(false)
  const [foeReeling, setFoeReeling] = useState(false)
  const [crowdBump, setCrowdBump] = useState(false)
  const [koFlash, setKoFlash] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [shake, setShake] = useState(false)
  const [banner, setBanner] = useState('')     // ROUND 1 / K.O. / TIME!
  const sparkId = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const replayStarted = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const profileRef = useRef<string | null>(null)

  // Chat state (post-fight)
  const [chatEnabled, setChatEnabled] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [otherUsername, setOtherUsername] = useState('')
  const chatRef = useRef<HTMLDivElement>(null)

  const fetchChallenge = useCallback(async () => {
    if (!challengeId) return
    try {
      const res = await fetch(`/api/pvp/${challengeId}`)
      if (!res.ok) return
      const data: ChallengeData = await res.json()
      setChallenge(data)
      if (data.status === 'completed') {
        if (pollRef.current) clearInterval(pollRef.current)
        // v2 logs are server-simulated replays; interactive (v3) fights jump
        // straight to the result — the fight already happened live
        setPhase(p => (p === 'loading' || p === 'waiting')
          ? (data.battle_log?.version === 2 ? 'intro' : 'done')
          : p)
      } else if (data.status === 'accepted') {
        // Armed: BOTH participants fight it live in real time
        if (profileRef.current &&
          (data.challenger_id === profileRef.current || data.defender_id === profileRef.current)) {
          if (pollRef.current) clearInterval(pollRef.current)
          setPhase(p => (p === 'loading' || p === 'waiting') ? 'intro' : p)
        } else {
          setPhase('waiting')
        }
      } else if (data.status === 'pending' || data.status === 'resolving') {
        setPhase('waiting')
      } else {
        setPhase('aborted')
        if (pollRef.current) clearInterval(pollRef.current)
      }
    } catch {}
  }, [challengeId])

  useEffect(() => { profileRef.current = profile?.id ?? null }, [profile?.id])

  useEffect(() => {
    fetchChallenge()
    pollRef.current = setInterval(fetchChallenge, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchChallenge])

  // The 'accepted' branch needs the profile id — refetch once it loads
  useEffect(() => { if (profile?.id) fetchChallenge() }, [profile?.id, fetchChallenge])

  // Perspective
  const isChallenger = profile && challenge ? challenge.challenger_id === profile.id : true
  const me = isChallenger ? 'c' : 'd'
  const myUsername = isChallenger ? challenge?.challenger_username : challenge?.defender_username
  const theirUsername = isChallenger ? challenge?.defender_username : challenge?.challenger_username
  const myParty = isChallenger ? challenge?.challenger_party : challenge?.defender_party
  const theirParty = isChallenger ? challenge?.defender_party : challenge?.challenger_party

  const log = challenge?.battle_log
  const validLog = log && log.version === 2 && Array.isArray(log.events)
  const isLive = challenge?.status === 'accepted' && !!profile
    && (challenge.challenger_id === profile.id || challenge.defender_id === profile.id)
  const oppIsBot = isChallenger ? !!challenge?.defender_is_bot : !!challenge?.challenger_is_bot
  // Chosen 3D fighters for the arena
  const myPvpFighter = (isChallenger ? challenge?.challenger_pvp_fighter : challenge?.defender_pvp_fighter) || 'fighter1'
  const oppPvpFighter = (isChallenger ? challenge?.defender_pvp_fighter : challenge?.challenger_pvp_fighter) || 'fighter1'
  // Human opponents fight in REAL TIME over a Supabase channel; bots (and
  // human opponents who never show up) are fought as AI at their level
  const realtime = isLive && !oppIsBot
  const myFighter: FighterDesign = validLog
    ? sanitizeFighter(isChallenger ? log!.cFighter : log!.dFighter, profile?.id ?? 'me')
    : sanitizeFighter(isChallenger ? challenge?.challenger_fighter : challenge?.defender_fighter, profile?.id ?? 'me')
  const foeFighter: FighterDesign = validLog
    ? sanitizeFighter(isChallenger ? log!.dFighter : log!.cFighter, 'foe')
    : sanitizeFighter(isChallenger ? challenge?.defender_fighter : challenge?.challenger_fighter, 'foe')
  const myLevel = validLog
    ? (isChallenger ? log!.cLevel : log!.dLevel)
    : (isChallenger ? challenge?.challenger_level ?? 1 : challenge?.defender_level ?? 1)
  const foeLevel = validLog
    ? (isChallenger ? log!.dLevel : log!.cLevel)
    : (isChallenger ? challenge?.defender_level ?? 1 : challenge?.challenger_level ?? 1)

  function addSpark(onFoe: boolean, text: string, color: string) {
    const id = ++sparkId.current
    // Positions in stage %: sparks land on whoever got hit
    const x = onFoe ? 62 + Math.random() * 10 : 26 + Math.random() * 10
    const y = 34 + Math.random() * 18
    setSparks(s => [...s, { id, x, y, text, color }])
    setTimeout(() => setSparks(s => s.filter(sp => sp.id !== id)), 800)
  }

  // Radiating impact burst (PixiJS-style particles, DOM edition)
  function addBurst(onFoe: boolean, heavy: boolean) {
    const cxp = onFoe ? 64 : 32   // impact point in stage %
    const cyp = 48
    const n = heavy ? 10 : 6
    const burst: typeof particles = []
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const dist = (heavy ? 34 : 22) + Math.random() * (heavy ? 46 : 26)
      burst.push({
        id: ++sparkId.current,
        x: cxp + (Math.random() - 0.5) * 4,
        y: cyp + (Math.random() - 0.5) * 6,
        dx: Math.cos(a) * dist,
        dy: Math.sin(a) * dist - 10,
        color: heavy && i % 3 === 0 ? '#f87171' : i % 2 === 0 ? '#fde047' : '#ffffff',
        size: heavy ? 5 + Math.random() * 4 : 3 + Math.random() * 3,
      })
    }
    setParticles(p => [...p, ...burst])
    const ids = new Set(burst.map(b => b.id))
    setTimeout(() => setParticles(p => p.filter(x => !ids.has(x.id))), 600)
  }

  function reel(onFoe: boolean) {
    const set = onFoe ? setFoeReeling : setMyReeling
    set(true)
    setTimeout(() => set(false), 230)
  }

  function bumpCrowd() {
    setCrowdBump(true)
    setTimeout(() => setCrowdBump(false), 260)
  }

  // ── Replay engine ─────────────────────────────────────────────────────────
  // Started exactly once per page load. Timers must NOT be tied to effect
  // cleanup on dep changes: the phase flips intro→fighting mid-replay, and
  // cleaning up then would cancel every scheduled punch.
  useEffect(() => {
    if (phase !== 'intro' || !validLog || !profile || replayStarted.current) return
    replayStarted.current = true
    const fight = log as FightLog
    const timers = timersRef.current

    const schedule = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)) }

    // Intro cards
    setBanner('ROUND 1')
    schedule(900, () => { setBanner('FIGHT!'); sfx.bell(true) })
    schedule(1500, () => { setBanner(''); setPhase('fighting') })

    const t0 = 1500 // fight starts after intro
    let comboHits = 0

    for (const ev of fight.events) {
      const at = t0 + ev.t * 1000
      const iAttack = ev.attacker === me

      schedule(at, () => {
        // attacker pose
        if (iAttack) { setMyPose(MOVE_POSE[ev.move]); setMyAttacking(true) }
        else { setFoePose(MOVE_POSE[ev.move]); setFoeAttacking(true) }
        setMoveText(`${iAttack ? 'YOU' : theirUsername?.toUpperCase() ?? 'FOE'}: ${MOVE_LABELS[ev.move]}`)
      })

      schedule(at + 110, () => {
        // defender reaction + damage
        const setDefPose = iAttack ? setFoePose : setMyPose
        const heavy = ev.move === 'hook' || ev.move === 'uppercut' || ev.move === 'kick'
          || ev.move === 'jumpkick' || ev.move === 'special'
        // Specials get the cinema treatment: flash frame + camera punch-in
        if (ev.move === 'special') {
          setKoFlash(true)
          setZoom(true)
          setTimeout(() => setKoFlash(false), 300)
          setTimeout(() => setZoom(false), 900)
        }
        if (ev.result === 'hit') {
          setDefPose('hit')
          reel(iAttack)
          addBurst(iAttack, heavy)
          addSpark(iAttack, `-${ev.dmg}`, iAttack ? '#facc15' : '#f87171')
          if (ev.move === 'kick') sfx.kick()
          else sfx.punch(heavy)
          if (ev.dmg >= 14 || heavy) { bumpCrowd(); sfx.crowd(0.4) }
          setShake(true)
          setTimeout(() => setShake(false), heavy ? 220 : 150)
          if (ev.comboLen > 1) {
            comboHits = ev.comboIndex + 1
            if (comboHits > 1) {
              setComboText(`${comboHits} HIT COMBO!`)
              setTimeout(() => setComboText(''), 900)
            }
          }
        } else if (ev.result === 'blocked') {
          setDefPose('block')
          addSpark(iAttack, 'BLOCK', '#93c5fd')
          sfx.block()
        } else {
          setDefPose('dodge')
          addSpark(iAttack, 'MISS', '#9ca3af')
          sfx.whoosh()
        }
        // HP from my perspective
        setMyHp(me === 'c' ? ev.chp : ev.dhp)
        setFoeHp(me === 'c' ? ev.dhp : ev.chp)
      })

      schedule(at + 330, () => {
        if (iAttack) { setMyPose('idle'); setMyAttacking(false) }
        else { setFoePose('idle'); setFoeAttacking(false) }
        const setDefPose = iAttack ? setFoePose : setMyPose
        setDefPose('idle')
      })
    }

    // Clock
    const clockStart = Date.now()
    const clockIv = setInterval(() => {
      const elapsed = (Date.now() - clockStart - t0) / 1000
      const end = Math.min(fight.endT, 30)
      setClock(Math.max(0, Math.ceil(Math.min(30, end) - Math.max(0, elapsed))))
    }, 200)
    timers.push(clockIv as unknown as ReturnType<typeof setTimeout>)

    // Ending — KO gets flash-frame + camera punch-in before the fall
    const endAt = t0 + fight.endT * 1000
    if (fight.endedBy === 'ko') {
      schedule(endAt - 150, () => {
        setKoFlash(true)
        setZoom(true)
        setTimeout(() => setKoFlash(false), 320)
      })
    }
    schedule(endAt, () => {
      const iWonFight = fight.winner === me
      setBanner(fight.endedBy === 'ko' ? 'K.O.!' : 'TIME!')
      if (iWonFight) { setMyPose('victory'); setFoePose('ko') }
      else { setMyPose('ko'); setFoePose('victory') }
      if (fight.endedBy === 'ko') sfx.ko()
      else sfx.bell(false)
      bumpCrowd()
      clearInterval(clockIv)
      setClock(fight.endedBy === 'ko' ? Math.max(0, 30 - Math.floor(fight.endT)) : 0)
    })
    schedule(endAt + 1400, () => setZoom(false))
    schedule(endAt + 1900, () => { setBanner(''); setPhase('done') })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, validLog, profile?.id])

  // Clear all replay timers only when leaving the page
  useEffect(() => {
    return () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }
  }, [])

  // Landing straight on a finished fight (defender view, page refresh):
  // show the final HP without a replay
  useEffect(() => {
    if (phase !== 'done' || !challenge || replayStarted.current || liveStarted.current) return
    const chp = challenge.challenger_hp_remaining ?? 100
    const dhp = challenge.defender_hp_remaining ?? 100
    setMyHp(isChallenger ? chp : dhp)
    setFoeHp(isChallenger ? dhp : chp)
    setClock(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, challenge?.id])

  // Result sting — once, when the result panel appears
  const stingPlayed = useRef(false)
  useEffect(() => {
    if (phase !== 'done' || stingPlayed.current || !challenge?.winner_id || !profile) return
    stingPlayed.current = true
    if (challenge.winner_id === profile.id) sfx.victory()
    else sfx.defeat()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ══ LIVE FIGHT ENGINE ══════════════════════════════════════════════════
  // The challenger plays for real: taps punch, 3-tap chains a combo finisher,
  // swipe toward the foe kicks, swipe up jump-kicks, holding blocks. The foe
  // is driven at the DEFENDER'S level — it telegraphs attacks (⚠ flash), and
  // blocking during the strike absorbs almost everything. Server validates
  // the submitted outcome before any FP moves.
  const TAP_CD = 380, KICK_CD = 750, JUMP_CD = 950, SPECIAL_CD = 600
  const DODGE_MS = 600, DODGE_CD = 950
  const [meter, setMeter] = useState(0)
  const [telegraph, setTelegraph] = useState(false)
  const [hint, setHint] = useState('')
  const [submitErr, setSubmitErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [awaitingOpp, setAwaitingOpp] = useState(false)
  const liveStarted = useRef(false)
  const channelRef = useRef<ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']> | null>(null)
  const L = useRef({
    startAt: 0, liveAt: 0, over: false, myCd: 0, tapAlt: false,
    comboN: 0, lastHit: 0, lastTouch: 0,
    blockHeld: false, blockTimer: 0 as ReturnType<typeof setTimeout> | 0,
    dodgeUntil: 0, dodgeCd: 0,
    touchX: 0, touchY: 0, touchT: 0,
    foeNextAt: 0, foeWindupAt: 0, foeMove: 'jab' as Move,
    synced: false, ghost: false, attackSeq: 0,
    lastResult: { won: false },
    counts: { taps: 0, kicks: 0, jumpkicks: 0, blocks: 0, combos: 0, specials: 0 },
    myHp: 100, foeHp: 100, meter: 0,
    // positional combat: fighter positions + guard state (mirrored from React)
    playerX: -1, oppX: 1, blocking: false, ducking: false, airborne: false, foeSpaceUntil: 0,
  })
  const foeStats = fighterStats(foeLevel)
  const myRole = isChallenger ? 'c' : 'd'

  function flashHint(msg: string) {
    setHint(msg)
    setTimeout(() => setHint(''), 1400)
  }

  // Intro banners for a live fight, then hand control to the player
  useEffect(() => {
    if (!isLive || phase !== 'intro' || liveStarted.current || !profile) return
    liveStarted.current = true
    setBanner('ROUND 1')
    const t1 = setTimeout(() => { setBanner('FIGHT!'); sfx.bell(true) }, 900)
    const t2 = setTimeout(() => {
      setBanner('')
      L.current.liveAt = Date.now()
      if (!realtime) {
        // Bot fight: clock starts now and the AI wakes up
        L.current.startAt = Date.now()
        L.current.foeNextAt = Date.now() + 1600
      }
      setPhase('live')
    }, 1500)
    timersRef.current.push(t1, t2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, phase, profile?.id])

  // ── Realtime channel: two humans exchange moves live ──────────────────────
  // Each client is authoritative for its OWN fighter: when the opponent's
  // attack arrives, WE resolve it against our block/dodge state and broadcast
  // the result back, so there's never a disputed damage roll.
  useEffect(() => {
    if (phase !== 'live' || !realtime || !challengeId) return
    const S = L.current
    const supabase = createSupabaseBrowserClient()
    const ch = supabase.channel(`fight-${challengeId}`, {
      config: { presence: { key: myRole }, broadcast: { self: false } },
    })
    channelRef.current = ch

    const applyIncomingAttack = (p: { seq: number; move: Move; right?: boolean }) => {
      if (S.over) return
      const def = MOVES.find(m => m.move === p.move)!
      const heavy = def.mult > 1
      const now = Date.now()
      setFoePose(MOVE_POSE[p.move]); setFoeAttacking(true)
      foeJab(!!p.right) // 3D: right or left jab
      setTimeout(() => { if (!L.current.over) { setFoePose('idle'); setFoeAttacking(false) } }, 280)
      setMoveText(`${theirUsername?.toUpperCase() ?? 'FOE'}: ${MOVE_LABELS[p.move]}`)

      let result: 'hit' | 'blocked' | 'dodged' = 'hit'
      let dmg = 0
      const outOfRange = dist(S.oppX, S.playerX) > STRIKE_RANGE
      const guarding = S.blockHeld || S.blocking
      if (outOfRange || now < S.dodgeUntil || S.ducking || S.airborne) {
        result = 'dodged'
        addSpark(false, outOfRange ? 'WHIFF' : 'DODGED!', outOfRange ? '#9ca3af' : '#4ade80')
        sfx.whoosh()
      } else if (guarding) {
        result = 'blocked'
        dmg = Math.max(0, Math.floor(strikeDamage(foeLevel, def.mult) * 0.15))
        S.counts.blocks++
        addSpark(false, 'BLOCKED!', '#93c5fd')
        sfx.block(); buzz(15)
      } else {
        dmg = strikeDamage(foeLevel, def.mult)
        setMyPose('hit'); reel(false); addBurst(false, heavy)
        addSpark(false, `-${dmg}`, '#f87171')
        setPlayerHitKey(k => k + 1); S.playerX = Math.max(-2.6, S.playerX - 0.16); setPlayerX(S.playerX) // 3D flinch + knockback
        if (p.move === 'kick' || p.move === 'jumpkick') sfx.kick()
        else sfx.punch(heavy)
        setShake(true); setTimeout(() => setShake(false), 170)
        setTimeout(() => { if (!L.current.over && !L.current.blockHeld) setMyPose('idle') }, 240)
      }
      const t = S.startAt ? (now - S.startAt) / 1000 : 0
      if (dmg >= S.myHp && t < 14) dmg = Math.max(0, S.myHp - 1) // no KO before 14s
      S.myHp = Math.max(0, S.myHp - dmg)
      setMyHp(S.myHp)
      ch.send({ type: 'broadcast', event: 'result', payload: { seq: p.seq, result, dmg, hp: S.myHp } })
      if (S.myHp === 0) endFight(false, true)
    }

    const applyMyAttackResult = (p: { seq: number; result: 'hit' | 'blocked' | 'dodged'; dmg: number; hp: number }) => {
      if (S.over) return
      S.foeHp = Math.max(0, Math.min(100, p.hp))
      setFoeHp(S.foeHp)
      if (p.result === 'hit') {
        setFoePose('hit'); reel(true); addBurst(true, p.dmg >= 10)
        addSpark(true, `-${p.dmg}`, '#facc15')
        setOppHitKey(k => k + 1); S.oppX = Math.min(1.8, S.oppX + 0.16); setOppX(S.oppX) // 3D flinch + knockback
        S.meter = Math.min(100, S.meter + p.dmg * 1.7)
        setMeter(S.meter)
        if (p.dmg >= 10) { bumpCrowd(); sfx.crowd(0.3) }
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 240)
      } else if (p.result === 'blocked') {
        setFoePose('block')
        addSpark(true, 'BLOCK', '#93c5fd'); sfx.block()
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 300)
      } else {
        setFoePose('dodge')
        addSpark(true, 'MISS', '#9ca3af'); sfx.whoosh()
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 300)
      }
      if (S.foeHp === 0) endFight(true, true)
    }

    ch
      .on('broadcast', { event: 'move' }, ({ payload }) => applyIncomingAttack(payload))
      .on('broadcast', { event: 'result' }, ({ payload }) => applyMyAttackResult(payload))
      // opponent's position (mirrored: their left-side X → our right-side X)
      .on('broadcast', { event: 'pos' }, ({ payload }) => { S.oppX = -payload.x; setOppX(-payload.x) })
      .on('presence', { event: 'sync' }, () => {
        const roles = Object.keys(ch.presenceState())
        const both = roles.includes('c') && roles.includes('d')
        if (both && !S.synced && !S.ghost) {
          S.synced = true
          S.startAt = Date.now()
          setAwaitingOpp(false)
          setBanner('FIGHT!')
          sfx.bell(true)
          setTimeout(() => setBanner(''), 800)
        }
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') await ch.track({ at: Date.now() })
      })

    if (!S.synced) setAwaitingOpp(true)

    return () => {
      channelRef.current = null
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, realtime, challengeId])

  function foeInterval() {
    const base = Math.max(950, 2300 - foeLevel * 70)
    return base * (0.75 + Math.random() * 0.5)
  }

  function endFight(won: boolean, ko: boolean) {
    const S = L.current
    if (S.over) return
    S.over = true
    S.lastResult = { won }
    setTelegraph(false)
    if (won) { setMyPose('victory'); setFoePose('ko') }
    else { setMyPose('ko'); setFoePose('victory') }
    if (ko) { setKoFlash(true); setZoom(true); sfx.ko(); setTimeout(() => { setKoFlash(false); setZoom(false) }, 900) }
    else sfx.bell(false)
    setBanner(ko ? 'K.O.!' : 'TIME!')
    bumpCrowd()
    setTimeout(() => { setBanner(''); submitFight(won) }, 1500)
  }

  async function submitFight(won: boolean) {
    const S = L.current
    setSubmitting(true)
    const payload = {
      won,
      myHp: S.myHp,
      foeHp: S.foeHp,
      duration: Math.min(35, Math.max(14, Math.round((Date.now() - S.startAt) / 1000))),
      counts: S.counts,
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/pvp/${challengeId}/fight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (res.ok) {
          setSubmitting(false)
          await fetchChallenge()
          setPhase('done')
          return
        }
        if (res.status === 409) {
          // Opponent's client already settled it — just show the result
          setSubmitting(false)
          await fetchChallenge()
          setPhase('done')
          return
        }
        // Validation rejections won't change on retry
        setSubmitting(false)
        setSubmitErr(data.error || 'Could not save the fight result')
        return
      } catch { /* network hiccup — retry once */ }
    }
    setSubmitting(false)
    setSubmitErr('Network error — the fight result could not be saved')
  }

  // Jump back — full dodge window; any attack arriving during it misses
  function playerDodge() {
    const S = L.current
    if (phase !== 'live' || S.over || S.blockHeld) return
    const now = Date.now()
    if (now < S.dodgeCd) return
    S.dodgeUntil = now + DODGE_MS
    S.dodgeCd = now + DODGE_CD
    setMyPose('dodge')
    setMyReeling(true)
    sfx.whoosh(); buzz(8)
    setTimeout(() => {
      setMyReeling(false)
      if (!L.current.over && Date.now() >= L.current.dodgeUntil) setMyPose('idle')
    }, 320)
    setTimeout(() => { if (!L.current.over && !L.current.blockHeld) setMyPose('idle') }, DODGE_MS)
  }

  // Player attack (shared by taps, swipes, keys, and the special button).
  // Every move is available at every level — damage scales with YOUR level.
  function playerStrike() {
    const S = L.current
    if (phase !== 'live' || S.over || S.blockHeld) return
    const now = Date.now()
    if (now < S.myCd || now < S.dodgeUntil) return
    if (realtime && !S.ghost && !S.synced) { flashHint(`⏳ Waiting for ${theirUsername ?? 'opponent'} to enter...`); return }
    S.myCd = now + TAP_CD
    // Boxing: every tap is a jab. One tap = right jab; a quick second tap
    // becomes the left of a left/right combo (alternates, resets after a pause).
    const right = (now - S.lastHit > 600) ? true : !S.tapAlt
    S.tapAlt = right
    S.lastHit = now
    S.counts.taps++
    const actual: Move = 'jab'
    const heavy = false
    setMyPose(MOVE_POSE['jab']); setMyAttacking(true)
    myJab(right) // 3D: right or left jab
    setTimeout(() => { if (!L.current.over) { setMyPose('idle'); setMyAttacking(false) } }, 280)
    setMoveText(`YOU: ${right ? 'RIGHT JAB' : 'LEFT JAB'}`)

    if (realtime && !S.ghost) {
      const seq = ++S.attackSeq
      channelRef.current?.send({ type: 'broadcast', event: 'move', payload: { seq, move: 'jab', right } })
      return
    }

    // AI mode: impact resolves a beat later against the foe's stats
    setTimeout(() => {
      if (S.over) return
      // Contact-based: must be within range of the foe or the strike whiffs
      if (dist(S.playerX ?? -1, S.oppX ?? 1) > STRIKE_RANGE) {
        addSpark(true, 'WHIFF', '#9ca3af'); sfx.whoosh()
        return
      }
      const mult = MOVES.find(m => m.move === actual)!.mult
      const roll = Math.random()
      let result: 'hit' | 'blocked' | 'dodged' = 'hit'
      if (roll < foeStats.dodgeChance) result = 'dodged'
      else if (roll < foeStats.dodgeChance + foeStats.blockChance) result = 'blocked'
      let dmg = 0
      if (result !== 'dodged') {
        dmg = strikeDamage(myLevel, mult)
        if (result === 'blocked') dmg = Math.max(1, Math.floor(dmg * 0.25))
      }
      const t = (Date.now() - S.startAt) / 1000
      if (dmg >= S.foeHp && t < 14) dmg = Math.max(0, S.foeHp - 1) // no KO before 14s
      S.foeHp = Math.max(0, S.foeHp - dmg)
      setFoeHp(S.foeHp)
      if (result === 'hit') {
        setFoePose('hit'); reel(true); addBurst(true, heavy)
        addSpark(true, `-${dmg}`, '#facc15')
        setOppHitKey(k => k + 1); S.oppX = Math.min(1.8, S.oppX + 0.16); setOppX(S.oppX) // 3D flinch + knockback
        sfx.punch(heavy)
        S.meter = Math.min(100, S.meter + dmg * 1.7)
        setMeter(S.meter)
        if (heavy) { bumpCrowd(); sfx.crowd(0.3) }
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 240)
      } else if (result === 'blocked') {
        addSpark(true, 'BLOCK', '#93c5fd'); sfx.block()
      } else {
        addSpark(true, 'MISS', '#9ca3af'); sfx.whoosh()
      }
      if (S.foeHp === 0) endFight(true, true)
    }, 120)
  }

  // Game tick: clock, bell, ghost fallback, and the AI foe (bots + no-shows)
  useEffect(() => {
    if (phase !== 'live') return
    const S = L.current
    const iv = setInterval(() => {
      if (S.over) return
      const now = Date.now()

      // Realtime fight not synced yet: freeze the clock and wait. If the
      // opponent never enters the ring, their AI ghost steps in.
      if (realtime && !S.ghost && !S.synced) {
        if (now - S.liveAt > 20_000) {
          S.ghost = true
          S.startAt = now
          S.foeNextAt = now + 1400
          setAwaitingOpp(false)
          flashHint(`${theirUsername ?? 'Opponent'} didn't show — fighting their fighter`)
          setBanner('FIGHT!')
          sfx.bell(true)
          setTimeout(() => setBanner(''), 800)
        }
        return
      }

      const t = (now - S.startAt) / 1000
      setClock(Math.max(0, Math.ceil(30 - t)))
      if (t >= 30) { endFight(S.myHp > S.foeHp, false); return }

      // AI opponent only (bots / ghosts) — humans attack via the channel
      if (realtime && !S.ghost) return

      // Approach: step toward the player until within striking range; after an
      // attack, hold at a longer distance briefly (spacing) before closing again
      if (!S.foeWindupAt) {
        const spacing = now < S.foeSpaceUntil ? STRIKE_RANGE * 1.4 : STRIKE_RANGE * 0.82
        const target = (S.playerX ?? -1) + spacing
        if (S.oppX > target + 0.04) { S.oppX = Math.max(target, S.oppX - FOE_STEP); setOppX(S.oppX) }
        else if (S.oppX < target - 0.04) { S.oppX = Math.min(target, S.oppX + FOE_STEP); setOppX(S.oppX) }
      }

      if (S.foeWindupAt && now >= S.foeWindupAt) {
        // Strike lands
        S.foeWindupAt = 0
        setTelegraph(false)
        const def = MOVES.find(m => m.move === S.foeMove)!
        const heavy = def.mult > 1
        setFoePose(MOVE_POSE[S.foeMove]); setFoeAttacking(true)
        foeJab(Math.random() < 0.5) // 3D: right or left jab
        setTimeout(() => { if (!L.current.over) { setFoePose('idle'); setFoeAttacking(false) } }, 280)
        setMoveText(`${theirUsername?.toUpperCase() ?? 'FOE'}: ${MOVE_LABELS[S.foeMove]}`)
        let dmg = strikeDamage(foeLevel, def.mult)
        const guarding = S.blockHeld || S.blocking
        if (dist(S.oppX ?? 1, S.playerX ?? -1) > STRIKE_RANGE) {
          dmg = 0
          addSpark(false, 'WHIFF', '#9ca3af')   // player backed out of range
          sfx.whoosh()
        } else if (now < S.dodgeUntil || S.ducking || S.airborne) {
          dmg = 0
          addSpark(false, 'DODGED!', '#4ade80') // ducked / jumped / dodged
          sfx.whoosh()
        } else if (guarding) {
          dmg = Math.max(0, Math.floor(dmg * 0.15))
          S.counts.blocks++
          addSpark(false, 'BLOCKED!', '#93c5fd')
          sfx.block(); buzz(15)
        } else {
          setMyPose('hit'); reel(false); addBurst(false, heavy)
          addSpark(false, `-${dmg}`, '#f87171')
          setPlayerHitKey(k => k + 1); S.playerX = Math.max(-2.6, S.playerX - 0.16); setPlayerX(S.playerX) // 3D flinch + knockback
          if (S.foeMove === 'kick' || S.foeMove === 'jumpkick') sfx.kick()
          else sfx.punch(heavy)
          setShake(true); setTimeout(() => setShake(false), 170)
          setTimeout(() => { if (!L.current.over && !L.current.blockHeld) setMyPose('idle') }, 240)
        }
        if (dmg >= S.myHp && t < 14) dmg = Math.max(0, S.myHp - 1)
        S.myHp = Math.max(0, S.myHp - dmg)
        setMyHp(S.myHp)
        if (S.myHp === 0) { endFight(false, true); return }
        S.foeNextAt = now + foeInterval()
        S.foeSpaceUntil = now + 650 // step back after attacking (spacing)
      } else if (!S.foeWindupAt && now >= S.foeNextAt && dist(S.oppX ?? 1, S.playerX ?? -1) <= STRIKE_RANGE) {
        // Wind up (only when in range): telegraphed — block, duck, or jump back NOW
        S.foeMove = 'jab'
        S.foeWindupAt = now + Math.max(380, 650 - foeLevel * 9)
        setTelegraph(true)
        sfx.tap()
      }
    }, 90)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Live inputs: touch (tap/swipe/hold), mouse, and keyboard ─────────────
  function liveTouchStart(x: number, y: number) {
    const S = L.current
    if (phase !== 'live' || S.over) return
    S.touchX = x; S.touchY = y; S.touchT = Date.now(); S.lastTouch = Date.now()
    S.blockTimer = setTimeout(() => {
      S.blockHeld = true
      setMyPose('block')
      buzz(10)
    }, 230)
  }
  function liveTouchEnd(x: number, y: number) {
    const S = L.current
    if (phase !== 'live') return
    S.lastTouch = Date.now()
    if (S.blockTimer) { clearTimeout(S.blockTimer); S.blockTimer = 0 }
    if (S.blockHeld) {
      S.blockHeld = false
      if (!S.over) setMyPose('idle')
      return
    }
    // Boxing: any tap or swipe throws a jab (movement lives on the D-pad)
    playerStrike()
  }
  useEffect(() => {
    if (phase !== 'live') return
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); playerStrike() }
      if (e.key === 'ArrowDown' || e.key === 's') { L.current.blockHeld = true; setMyPose('block') }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 's') {
        L.current.blockHeld = false
        if (!L.current.over) setMyPose('idle')
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Fetch chat when done
  useEffect(() => {
    if (phase !== 'done' || !challengeId) return
    fetch(`/api/pvp/${challengeId}/messages`)
      .then(r => r.json())
      .then(d => {
        setChatEnabled(!!d.chat_enabled)
        setMessages(d.messages ?? [])
        setOtherUsername(d.other_username ?? '')
      })
      .catch(() => {})
  }, [phase, challengeId])

  useEffect(() => {
    if (phase !== 'done' || !chatEnabled || !challengeId) return
    const interval = setInterval(() => {
      fetch(`/api/pvp/${challengeId}/messages`)
        .then(r => r.json())
        .then(d => { if (d.messages) setMessages(d.messages) })
        .catch(() => {})
    }, 4000)
    return () => clearInterval(interval)
  }, [phase, chatEnabled, challengeId])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!chatInput.trim() || !challengeId) return
    setChatLoading(true)
    try {
      const res = await fetch(`/api/pvp/${challengeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chatInput.trim() }),
      })
      const data = await res.json()
      if (data.message) { setMessages(prev => [...prev, data.message]); setChatInput('') }
    } catch {}
    setChatLoading(false)
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (profileLoading || phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🥊</div>
          <p className="text-gray-400">Loading fight...</p>
        </div>
      </div>
    )
  }

  if (phase === 'waiting') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-6xl mb-4">{challenge?.status === 'accepted' ? '🥊' : '⏳'}</div>
          <h2 className="text-white font-black text-2xl mb-2">
            {challenge?.status === 'accepted' ? 'Fight in progress...' : 'Waiting for opponent...'}
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            {challenge?.status === 'accepted'
              ? `${challenge?.challenger_username ?? 'Your challenger'} is fighting your fighter right now — the result will appear here`
              : `Waiting for ${challenge?.defender_username ?? 'your opponent'} to accept`}
          </p>
          <button onClick={() => router.push('/map')}
            className="px-6 py-3 bg-gray-800 text-gray-300 rounded-xl font-bold hover:bg-gray-700 transition">
            ← Back to Map
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'aborted') {
    const reason = challenge?.status === 'declined' ? 'declined the challenge'
      : challenge?.status === 'expired' ? "didn't respond in time"
      : 'The challenge was cancelled'
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-6xl mb-4">🤝</div>
          <h2 className="text-white font-black text-2xl mb-2">No Fight</h2>
          <p className="text-gray-400 text-sm mb-2">
            {challenge?.status === 'cancelled' ? reason : `${theirUsername ?? 'Your opponent'} ${reason}`}
          </p>
          <p className="text-gray-600 text-xs mb-6">No FP was exchanged</p>
          <button onClick={() => router.push('/map')}
            className="px-6 py-3 bg-gray-800 text-gray-300 rounded-xl font-bold hover:bg-gray-700 transition">
            ← Back to Map
          </button>
        </div>
      </div>
    )
  }

  const iWon = challenge?.winner_id === profile?.id
  const fpStake = challenge?.fp_stake ?? 0
  const myColor = myParty === 'democrat' ? '#2563eb' : '#dc2626'
  const theirColor = theirParty === 'democrat' ? '#2563eb' : '#dc2626'

  return (
    <div className="flex flex-col bg-gray-950 overflow-hidden overscroll-none"
      style={{ height: 'calc(100dvh - 5rem)' }}>
      <div className="battle-wipe" />

      {/* Landscape brawler — ask the player to turn sideways in portrait */}
      {!landscape && (
        <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col items-center justify-center text-center p-8">
          <div className="text-6xl mb-4 animate-pulse">🔄</div>
          <p className="text-white font-black text-xl">Rotate your phone sideways</p>
          <p className="text-gray-400 text-sm mt-2">This is a landscape brawler — turn to fight.</p>
        </div>
      )}

      {/* ══ STREET STAGE ══════════════════════════════════════════════════ */}
      {/* LIVE fights: the stage is the controller (tap/swipe/hold). Replays
          of old fights: taps just hype the crowd. */}
      <div className="relative overflow-hidden select-none"
        onClick={() => {
          if (phase === 'live') {
            // Desktop click = punch; suppress the synthetic click after touch
            if (Date.now() - L.current.lastTouch < 600) return
            playerStrike()
          } else if (phase === 'fighting') { bumpCrowd(); sfx.crowd(0.35) }
        }}
        onTouchStart={e => liveTouchStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={e => liveTouchEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
        style={{
          height: '74vh',
          animation: shake ? 'sfShake 0.16s linear' : 'none',
          transform: zoom ? 'scale(1.07)' : 'scale(1)',
          transition: 'transform 260ms ease-out',
          background: 'linear-gradient(180deg, #0d0a1e 0%, #221439 38%, #45274b 52%, #2b2b31 60%, #232329 74%, #1a1a1f 100%)',
        }}>

        {/* painted street backdrop — flashes brighter when the crowd pops on a big hit */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'url(/backgrounds/street_fight.webp)',
          backgroundSize: 'cover', backgroundPosition: 'center 72%',
          filter: crowdBump ? 'brightness(1.18) saturate(1.1)' : 'brightness(1) saturate(1)',
          transition: 'filter 130ms ease-out',
        }} />
        {/* darken the lower third so fighters + HUD pop off the art */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'linear-gradient(180deg, rgba(5,4,12,0.35) 0%, transparent 22%, transparent 55%, rgba(5,4,12,0.42) 100%)',
        }} />

        {/* party graffiti tags behind each corner */}
        <div className="absolute pointer-events-none font-black" style={{
          bottom: '30%', left: '4%', fontSize: 22, transform: 'rotate(-8deg) skewX(-6deg)',
          color: myColor, opacity: 0.20, filter: 'blur(0.4px)', letterSpacing: 1,
          textShadow: `2px 2px 0 ${myColor}55`,
        }}>{myParty === 'democrat' ? 'BLUE CREW' : 'RED RULES'}</div>
        <div className="absolute pointer-events-none font-black" style={{
          bottom: '32%', right: '4%', fontSize: 22, transform: 'rotate(6deg) skewX(6deg)',
          color: theirColor, opacity: 0.20, filter: 'blur(0.4px)', letterSpacing: 1,
          textShadow: `2px 2px 0 ${theirColor}55`,
        }}>{theirParty === 'democrat' ? 'BLUE CREW' : 'RED RULES'}</div>

        {/* manhole steam */}
        <div className="absolute pointer-events-none" style={{
          bottom: '12%', left: '47%', width: 46, height: 110,
          background: 'radial-gradient(ellipse 50% 40% at 50% 85%, rgba(255,255,255,0.25), transparent 70%)',
          filter: 'blur(7px)', animation: 'sfSteam 3.4s ease-out infinite',
        }} />
        <div className="absolute pointer-events-none" style={{
          bottom: '12%', left: '49%', width: 34, height: 90,
          background: 'radial-gradient(ellipse 50% 40% at 50% 85%, rgba(255,255,255,0.18), transparent 70%)',
          filter: 'blur(6px)', animation: 'sfSteam 4.1s ease-out infinite 1.6s',
        }} />

        {/* ── HUD: HP bars + clock ── */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-start gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-white text-xs font-black truncate">{myUsername ?? 'You'}</span>
              <span className="text-[9px] font-bold px-1 rounded" style={{ background: `${myColor}33`, color: myColor }}>Lv.{myLevel}</span>
            </div>
            <div className="h-3.5 bg-black/60 rounded-sm overflow-hidden border border-white/20" style={{ transform: 'skewX(-12deg)' }}>
              <div className="h-full transition-all duration-300"
                style={{ width: `${myHp}%`, background: 'linear-gradient(90deg, #fbbf24, #f59e0b)' }} />
            </div>
          </div>
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-black/70 border-2 border-white/30 flex items-center justify-center mt-1">
            <span className="text-white font-black text-lg tabular-nums">{clock}</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1 justify-end">
              <span className="text-[9px] font-bold px-1 rounded" style={{ background: `${theirColor}33`, color: theirColor }}>Lv.{foeLevel}</span>
              <span className="text-white text-xs font-black truncate">{theirUsername ?? 'Foe'}</span>
            </div>
            <div className="h-3.5 bg-black/60 rounded-sm overflow-hidden border border-white/20" style={{ transform: 'skewX(12deg)' }}>
              <div className="h-full transition-all duration-300 ml-auto"
                style={{ width: `${foeHp}%`, background: 'linear-gradient(90deg, #f59e0b, #fbbf24)' }} />
            </div>
          </div>
        </div>

        {/* combo text */}
        {comboText && (
          <div className="absolute left-1/2 top-[24%] -translate-x-1/2 z-20 pointer-events-none"
            style={{ animation: 'sfCombo 0.9s ease-out forwards' }}>
            <span className="font-black text-2xl" style={{ color: '#facc15', textShadow: '0 0 14px #f59e0b, 0 2px 4px #000' }}>
              {comboText}
            </span>
          </div>
        )}

        {/* sparks / damage popups */}
        {sparks.map(s => (
          <div key={s.id} className="absolute z-20 pointer-events-none"
            style={{ left: `${s.x}%`, top: `${s.y}%`, animation: 'sfSpark 0.8s ease-out forwards' }}>
            <span className="font-black text-xl" style={{ color: s.color, textShadow: `0 0 10px ${s.color}, 0 2px 4px #000` }}>
              {s.text}
            </span>
          </div>
        ))}

        {/* impact particle bursts */}
        {particles.map(pt => (
          <div key={pt.id} className="absolute z-20 pointer-events-none rounded-full"
            style={{
              left: `${pt.x}%`, top: `${pt.y}%`,
              width: pt.size, height: pt.size,
              background: pt.color,
              boxShadow: `0 0 ${pt.size * 1.5}px ${pt.color}`,
              ['--dx' as any]: `${pt.dx}px`,
              ['--dy' as any]: `${pt.dy}px`,
              animation: 'sfParticle 0.55s cubic-bezier(0.1, 0.6, 0.4, 1) forwards',
            }} />
        ))}

        {/* KO flash frame */}
        {koFlash && (
          <div className="absolute inset-0 z-40 pointer-events-none"
            style={{ background: 'white', animation: 'sfKoFlash 0.32s ease-out forwards' }} />
        )}

        {/* banner (ROUND 1 / FIGHT! / K.O.!) */}
        {banner && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <span className="font-black"
              style={{
                fontSize: banner === 'FIGHT!' || banner === 'K.O.!' ? 64 : 44,
                color: banner === 'K.O.!' ? '#f87171' : '#facc15',
                textShadow: '0 0 24px rgba(250,204,21,0.6), 0 4px 8px #000',
                animation: 'sfBanner 0.5s ease-out',
                letterSpacing: 2,
              }}>
              {banner}
            </span>
          </div>
        )}

        {/* ── 3D STREET ARENA (fighters + cheering crowd) ── */}
        {/* pointer-events-none so taps/swipes still reach the stage controller */}
        <div className="absolute inset-0 z-[5] pointer-events-none">
          <PvpArena3D
            playerPrefix={myPvpFighter}
            oppPrefix={oppPvpFighter}
            playerJabRKey={playerJabRKey}
            playerJabLKey={playerJabLKey}
            oppJabRKey={oppJabRKey}
            oppJabLKey={oppJabLKey}
            playerHitKey={playerHitKey}
            oppHitKey={oppHitKey}
            playerX={playerX}
            playerY={playerY}
            playerDuck={playerDuck}
            oppX={oppX}
          />
        </div>

        {/* move ticker */}
        {/* meter + special (live only) */}
        {phase === 'live' && (
          <div className="absolute bottom-9 left-3 right-3 z-20 flex items-center gap-2">
            <div className="flex-1 h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/15">
              <div className="h-full transition-all duration-200"
                style={{ width: `${meter}%`, background: 'linear-gradient(90deg, #f59e0b, #fde047)' }} />
            </div>
          </div>
        )}

        {/* foe telegraph — block NOW */}
        {telegraph && (
          <div className="absolute z-20 pointer-events-none" style={{ right: '16%', top: '24%' }}>
            <span className="text-4xl" style={{ animation: 'sfCombo 0.7s ease-out', display: 'inline-block' }}>⚠️</span>
          </div>
        )}

        {/* waiting for the human opponent to enter the ring */}
        {phase === 'live' && awaitingOpp && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none bg-black/40">
            <div className="text-center">
              <div className="text-4xl mb-2 animate-pulse">🥊</div>
              <p className="text-white font-black text-lg">Waiting for {theirUsername ?? 'opponent'}...</p>
              <p className="text-gray-400 text-xs mt-1">Fight starts when they step in (20s max)</p>
            </div>
          </div>
        )}

        {/* hint flash (locked moves, meter) */}
        {hint && (
          <div className="absolute bottom-20 left-0 right-0 text-center z-20 pointer-events-none">
            <span className="text-yellow-300 text-xs font-bold bg-black/60 px-3 py-1.5 rounded-full">{hint}</span>
          </div>
        )}

        {(phase === 'fighting' || phase === 'live') && moveText && (
          <div className="absolute bottom-2 left-0 right-0 z-20 text-center pointer-events-none">
            <span className="text-white/80 text-xs font-bold tracking-widest" style={{ textShadow: '0 2px 4px #000' }}>
              {moveText}
            </span>
          </div>
        )}

        {/* ── D-PAD controller (live fights): move / jump / duck / block ── */}
        {phase === 'live' && (
          <div className="absolute z-30 pointer-events-auto select-none"
            style={{ left: 14, bottom: 16, width: 138, height: 138 }}
            onClick={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onTouchEnd={e => e.stopPropagation()}>
            {(() => {
              const base = 'absolute w-11 h-11 rounded-full bg-black/55 border border-white/25 text-white text-lg flex items-center justify-center active:bg-white/30 transition'
              const stop = (e: any) => { e.stopPropagation(); e.preventDefault() }
              return (
                <>
                  <button title="Jump" className={base} style={{ top: 0, left: 47 }}
                    onPointerDown={e => { stop(e); doJump() }}>▲</button>
                  <button title="Duck" className={base} style={{ bottom: 0, left: 47 }}
                    onPointerDown={e => { stop(e); setPlayerDuck(true) }} onPointerUp={e => { stop(e); setPlayerDuck(false) }} onPointerLeave={() => setPlayerDuck(false)}>▼</button>
                  <button title="Back up" className={base} style={{ top: 47, left: 0 }}
                    onPointerDown={e => { stop(e); setPlayerX(x => Math.max(-2.4, x - 0.4)) }}>◀</button>
                  <button title="Move in" className={base} style={{ top: 47, right: 0 }}
                    onPointerDown={e => { stop(e); setPlayerX(x => Math.min(-0.35, x + 0.4)) }}>▶</button>
                  <button title="Block" className={`${base} ${blocking ? 'bg-blue-500/70' : ''}`} style={{ top: 47, left: 47 }}
                    onPointerDown={e => { stop(e); setBlocking(true) }} onPointerUp={e => { stop(e); setBlocking(false) }} onPointerLeave={() => setBlocking(false)}>🛡</button>
                </>
              )
            })()}
          </div>
        )}

        {/* skip hint */}
      </div>

      {/* ══ BELOW THE STAGE ═══════════════════════════════════════════════ */}
      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {submitErr ? (
          <div className="max-w-md mx-auto text-center space-y-3">
            <p className="text-red-400 text-sm font-bold">⚠️ {submitErr}</p>
            <button onClick={() => { setSubmitErr(''); submitFight(L.current.lastResult.won) }}
              className="px-6 py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-700 transition">
              🔄 Retry
            </button>
          </div>
        ) : submitting ? (
          <p className="text-gray-400 text-xs text-center">⏳ Recording the result...</p>
        ) : phase === 'live' ? (
          <div className="text-center space-y-1">
            <p className="text-white/80 text-xs font-bold">👊 TAP = jab · double-tap = 1-2 combo</p>
            <p className="text-gray-400 text-[11px]">D-pad: ◀ ▶ move · ▲ jump · ▼ duck · 🛡 block — move in to land hits</p>
          </div>
        ) : phase !== 'done' ? (
          <p className="text-gray-600 text-xs text-center">🥊 Street fight in progress — one round, 30 seconds</p>
        ) : (
          <div className="max-w-md mx-auto space-y-3">
            <div className="text-center">
              <div className="text-5xl mb-1">{iWon ? '🏆' : '💀'}</div>
              <h2 className="font-black text-3xl" style={{ color: iWon ? '#22c55e' : '#ef4444' }}>
                {iWon ? 'VICTORY!' : 'DEFEATED!'}
              </h2>
              <p className="text-gray-400 text-sm">
                {(log as any)?.endedBy === 'bell'
                  ? `by decision vs ${theirUsername} — went the distance`
                  : `by knockout vs ${theirUsername}`}
              </p>
              <div className="inline-block mt-2 px-6 py-2 rounded-xl border"
                style={{ background: iWon ? '#22c55e11' : '#ef444411', borderColor: iWon ? '#22c55e44' : '#ef444444' }}>
                <span className="font-black text-2xl" style={{ color: iWon ? '#22c55e' : '#ef4444' }}>
                  {iWon ? '+' : '-'}{fpStake} FP
                </span>
              </div>
            </div>

            <button onClick={() => router.push('/map')}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold transition">
              Back to Map
            </button>

            {!chatEnabled && (
              <p className="text-gray-600 text-xs text-center">Enable messaging in Profile to chat after fights</p>
            )}

            {chatEnabled && (
              <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <p className="text-gray-400 text-xs uppercase tracking-wider">Chat with {otherUsername}</p>
                </div>
                <div ref={chatRef} className="max-h-40 overflow-y-auto p-3 space-y-2">
                  {messages.length === 0 ? (
                    <p className="text-gray-600 text-xs text-center py-2">No messages yet — talk some trash!</p>
                  ) : messages.map(msg => {
                    const isMe = msg.sender_id === profile?.id
                    return (
                      <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-xs px-3 py-1.5 rounded-xl text-sm text-white"
                          style={{ background: isMe ? '#7c3aed' : '#1f2937' }}>
                          {msg.content}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-2 p-3 border-t border-gray-800">
                  <input
                    type="text" value={chatInput} maxLength={200}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Message..."
                    className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-600 border border-transparent focus:border-purple-700 transition"
                  />
                  <button onClick={sendMessage} disabled={chatLoading || !chatInput.trim()}
                    className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white text-sm rounded-xl font-bold transition">
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes sfShake { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-7px,3px)} 50%{transform:translate(6px,-3px)} 75%{transform:translate(-4px,2px)} }
        @keyframes sfSpark { 0%{transform:translateY(0) scale(0.7);opacity:1} 100%{transform:translateY(-46px) scale(1.15);opacity:0} }
        @keyframes sfCombo { 0%{transform:translateX(-50%) scale(0.6);opacity:0} 20%{transform:translateX(-50%) scale(1.2);opacity:1} 80%{transform:translateX(-50%) scale(1);opacity:1} 100%{transform:translateX(-50%) scale(1);opacity:0} }
        @keyframes sfBanner { 0%{transform:scale(2.4);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes sfParticle { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(var(--dx),var(--dy)) scale(0.3);opacity:0} }
        @keyframes sfKoFlash { 0%{opacity:0.9} 100%{opacity:0} }
        @keyframes sfNeon { 0%,100%{opacity:1} 92%{opacity:1} 93%{opacity:0.4} 94%{opacity:1} 96%{opacity:0.6} 97%{opacity:1} }
        @keyframes sfSteam { 0%{transform:translateY(0) scaleX(1);opacity:0} 15%{opacity:0.8} 100%{transform:translateY(-70px) scaleX(1.7);opacity:0} }
      `}</style>
    </div>
  )
}

export default function PvpBattlePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Loading fight...</span>
      </div>
    }>
      <StreetFightPage />
    </Suspense>
  )
}

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
import { headSideImage } from '@/config/heads'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'
import dynamic from 'next/dynamic'

const PvpArena3D = dynamic(() => import('@/components/PvpArena3D'), { ssr: false })
// hit-stop lives in the arena module; loaded lazily (client only)
let triggerHitStop: (ms: number) => void = () => {}
if (typeof window !== 'undefined') {
  import('@/components/PvpArena3D').then(m => { triggerHitStop = m.triggerHitStop })
}

// Fighters HOLD their guard at boxing mid-range (ANCHOR apart) and trade from
// there. A strike only LANDS when the gap is within that move's VISUAL reach —
// if the fist/foot clearly can't touch the opponent, it whiffs. Stepping back
// with the D-pad is real defense; stepping in closes the distance.
const ANCHOR = 0.55         // each fighter's resting |x| (0.55 => 1.1 apart)
const PUNCH_RANGE = 1.25    // gap where an extended fist visually connects
const KICK_RANGE = 1.5      // kicks reach farther — can still catch a retreat step
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
  challenger_head_id?: string | null
  defender_head_id?: string | null
}

interface ChatMessage { id: string; sender_id: string; content: string; created_at: string }

const MOVE_LABELS: Record<string, string> = {
  jab: 'JAB', cross: 'PUNCH', hook: 'LEG KICK', uppercut: 'UPPERCUT', kick: 'HEAD KICK',
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
  // GUEST MODE (Michael 2026-07-23): a fight-me link visitor with no account
  // fights the owner's fighter (AI at their level) right in the browser —
  // sign-up is pitched AFTER the fight, not before.
  const guestVs = searchParams.get('vs')
  // guest=1 alone is enough: real street fights arrive as ?id=<uuid>&guest=1
  // (no vs param — requiring vs left the flag false and the page tried the
  // AUTHED challenge API, 404-looping on "Loading fight..." forever)
  const guest = searchParams.get('guest') === '1'
  // Seeded arena variety (presentation brief Phase B4): hash a stable fight id
  // so BOTH H2H clients land on the same stage. Pressroom is lobby-only.
  const arena = (() => {
    const FIGHT_ARENAS = ['foundry', 'club', 'rooftop']
    const seed = challengeId ?? guestVs
    if (!seed) return 'foundry'
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
    return FIGHT_ARENAS[Math.abs(h) % FIGHT_ARENAS.length]
  })()
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
  const [playerKickHiKey, setPlayerKickHiKey] = useState(0)
  const [playerKickLoKey, setPlayerKickLoKey] = useState(0)
  const [oppKickHiKey, setOppKickHiKey] = useState(0)
  const [oppKickLoKey, setOppKickLoKey] = useState(0)
  const [playerHitKey, setPlayerHitKey] = useState(0)
  const [oppHitKey, setOppHitKey] = useState(0)
  // 3D contact stamp (presentation brief Phase B): fired at every resolved
  // contact so the impact reads IN the scene, not just as DOM overlays
  const [impactFx, setImpactFx] = useState<{ key: number; side: 'player' | 'opp'; kind: 'light' | 'heavy' | 'special' | 'block' } | undefined>(undefined)
  const fireImpact = (side: 'player' | 'opp', kind: 'light' | 'heavy' | 'special' | 'block') =>
    setImpactFx(f => ({ key: (f?.key ?? 0) + 1, side, kind }))
  // ★ SPECIAL cinema (brief Phase C2): full-frame party-color flash
  const [specialFlash, setSpecialFlash] = useState<string | null>(null)
  const flashSpecial = (color: string) => {
    setSpecialFlash(color)
    setTimeout(() => setSpecialFlash(null), 450)
  }
  const myJab = (right: boolean) => right ? setPlayerJabRKey(k => k + 1) : setPlayerJabLKey(k => k + 1)
  const myKick = (high: boolean) => high ? setPlayerKickHiKey(k => k + 1) : setPlayerKickLoKey(k => k + 1)
  const foeKick = (high: boolean) => high ? setOppKickHiKey(k => k + 1) : setOppKickLoKey(k => k + 1)
  const foeJab = (right: boolean) => right ? setOppJabRKey(k => k + 1) : setOppJabLKey(k => k + 1)
  // D-pad movement for the 3D player fighter
  const [playerX, setPlayerX] = useState(-ANCHOR) // position along the fight line
  const [playerY, setPlayerY] = useState(0)       // jump height
  const [playerDuck, setPlayerDuck] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [oppBlocking, setOppBlocking] = useState(false) // opponent's live block pose
  const [oppX, setOppX] = useState(ANCHOR)         // opponent position (AI-driven)
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
  // the strike can visually reach (PUNCH_RANGE / KICK_RANGE).
  useEffect(() => {
    L.current.playerX = playerX
    // human PvP: share my position (channelRef is only set in realtime fights)
    channelRef.current?.send({ type: 'broadcast', event: 'pos', payload: { x: playerX } })
  }, [playerX])
  useEffect(() => { L.current.oppX = oppX }, [oppX])
  useEffect(() => { L.current.blocking = blocking }, [blocking])
  useEffect(() => { L.current.ducking = playerDuck }, [playerDuck])
  useEffect(() => { L.current.airborne = playerY > 0.25 }, [playerY])
  useEffect(() => { if (phase === 'live') { setPlayerX(-ANCHOR); setOppX(ANCHOR); L.current.playerX = -ANCHOR; L.current.oppX = ANCHOR } }, [phase])
  // Landscape brawler: nudge the phone sideways (and best-effort lock)
  const [landscape, setLandscape] = useState(true)
  // LAYOUT MODE: 'portrait' = vertical fight with a bottom control deck (new,
  // default for the trial); 'landscape' = the original rotate-your-phone
  // brawler. Persisted so players keep their preference.
  const [layout, setLayoutState] = useState<'landscape' | 'portrait'>('portrait')
  useEffect(() => {
    try { const v = localStorage.getItem('pvp_layout'); if (v === 'landscape' || v === 'portrait') setLayoutState(v) } catch {}
  }, [])
  const setLayout = (v: 'landscape' | 'portrait') => {
    setLayoutState(v)
    try { localStorage.setItem('pvp_layout', v) } catch {}
  }
  useEffect(() => {
    if (layout === 'landscape') { try { (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}) } catch {} }
    else { try { (screen.orientation as any)?.unlock?.() } catch {} }
  }, [layout])
  useEffect(() => {
    const check = () => setLandscape(window.innerWidth >= window.innerHeight)
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
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
  const [banner, setBanner] = useState('')     // 3/2/1/FIGHT! / K.O. / TIME!
  // both fighters' models loaded — the live intro is HELD until this is true
  // (Michael: fighters weren't visible when the fight began)
  const [arenaReady, setArenaReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setArenaReady(true), 8000) // broken-model failsafe
    return () => clearTimeout(t)
  }, [])
  const [hpShake, setHpShake] = useState(0)    // heavy-hit HP bar shake driver
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
    if (guest) {
      try {
        if (challengeId) {
          // REAL street fight (guest vs the link owner, live): public window
          // onto the challenge row — realtime engages like any human fight
          const res = await fetch(`/api/public/fight/challenge/${challengeId}`)
          if (!res.ok) { setPhase('aborted'); return }
          const data = await res.json()
          setChallenge(data)
          if (data.status === 'completed') {
            if (pollRef.current) clearInterval(pollRef.current)
            setPhase(p => (p === 'loading' || p === 'waiting') ? 'done' : p)
          } else if (data.status === 'accepted') {
            setPhase(p => (p === 'loading' || p === 'waiting') ? 'intro' : p)
          } else {
            setPhase('aborted')
            if (pollRef.current) clearInterval(pollRef.current)
          }
          return
        }
        // demo fallback: the owner's fighter on AI autopilot
        if (!guestVs) { setPhase('aborted'); return }
        const res = await fetch(`/api/public/fight/${guestVs}`)
        if (!res.ok) { setPhase('aborted'); return }
        setChallenge(await res.json())
        setPhase(p => (p === 'loading' || p === 'waiting') ? 'intro' : p)
      } catch {}
      return
    }
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
  }, [challengeId, guest, guestVs])

  useEffect(() => { profileRef.current = profile?.id ?? null }, [profile?.id])

  useEffect(() => {
    fetchChallenge()
    if (guest && !challengeId) return // demo mode — nothing to poll
    pollRef.current = setInterval(fetchChallenge, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchChallenge, guest, challengeId])

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
  const isLive = challenge?.status === 'accepted' && (guest || (!!profile
    && (challenge.challenger_id === profile.id || challenge.defender_id === profile.id)))
  const oppIsBot = isChallenger ? !!challenge?.defender_is_bot : !!challenge?.challenger_is_bot
  // Chosen 3D fighters for the arena — each fighter has a blue (Democrat) and
  // red (Republican) team-kit model; pick the variant matching each player's party.
  const partySuffix = (p?: string) => (p === 'republican' ? 'rep' : 'dem')
  const myBaseFighter = (isChallenger ? challenge?.challenger_pvp_fighter : challenge?.defender_pvp_fighter) || 'fighter1'
  const oppBaseFighter = (isChallenger ? challenge?.defender_pvp_fighter : challenge?.challenger_pvp_fighter) || 'fighter1'
  const myPvpFighter = `${myBaseFighter}_${partySuffix(myParty)}`
  const oppPvpFighter = `${oppBaseFighter}_${partySuffix(theirParty)}`
  // Swapped caricature heads (null = the body's own head)
  const myHeadId = isChallenger ? challenge?.challenger_head_id : challenge?.defender_head_id
  const oppHeadId = isChallenger ? challenge?.defender_head_id : challenge?.challenger_head_id
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

  // Some bots are just GOOD (Michael): a stable 0..1 skill from the
  // opponent's id — the same notion the bot league sim uses — makes certain
  // bots noticeably faster and snappier in live fights.
  const foeId = isChallenger ? challenge?.defender_id : challenge?.challenger_id
  const foeSkill = (() => {
    if (!foeId) return 0.5
    let h = 0
    for (let i = 0; i < foeId.length; i++) h = (Math.imul(31, h) + foeId.charCodeAt(i)) | 0
    return (Math.abs(h) % 1024) / 1023
  })()

  function addSpark(onFoe: boolean, text: string, color: string) {
    const id = ++sparkId.current
    // Impact zone near mid-fighter height (portrait + landscape)
    const x = onFoe ? 58 + Math.random() * 12 : 28 + Math.random() * 12
    const y = 38 + Math.random() * 14
    setSparks(s => [...s, { id, x, y, text, color }])
    setTimeout(() => setSparks(s => s.filter(sp => sp.id !== id)), 900)
  }

  // Radiating impact burst — denser + brighter on heavy hits
  function addBurst(onFoe: boolean, heavy: boolean) {
    const cxp = onFoe ? 62 : 34
    const cyp = 44
    const n = heavy ? 16 : 9
    const burst: typeof particles = []
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const dist = (heavy ? 42 : 26) + Math.random() * (heavy ? 52 : 30)
      burst.push({
        id: ++sparkId.current,
        x: cxp + (Math.random() - 0.5) * 5,
        y: cyp + (Math.random() - 0.5) * 6,
        dx: Math.cos(a) * dist,
        dy: Math.sin(a) * dist - 12,
        color: heavy && i % 3 === 0 ? '#f87171' : i % 2 === 0 ? '#fde047' : '#ffffff',
        size: heavy ? 6 + Math.random() * 5 : 3.5 + Math.random() * 3.5,
      })
    }
    setParticles(p => [...p, ...burst])
    const ids = new Set(burst.map(b => b.id))
    setTimeout(() => setParticles(p => p.filter(x => !ids.has(x.id))), 700)
  }

  // Live combo chain (hits within 900ms of each other)
  const comboRef = useRef({ n: 0, at: 0 })
  function noteComboHit() {
    const now = Date.now()
    const c = comboRef.current
    c.n = now - c.at < 900 ? c.n + 1 : 1
    c.at = now
    if (c.n >= 2) {
      setComboText(c.n >= 5 ? `${c.n} HIT!!!` : c.n >= 3 ? `${c.n} HIT COMBO!` : `${c.n} HIT!`)
      setTimeout(() => setComboText(t => (t.includes(String(c.n)) ? '' : t)), 700)
    }
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
    if (phase !== 'intro' || !validLog || !profile || replayStarted.current || !arenaReady) return
    replayStarted.current = true
    const fight = log as FightLog
    const timers = timersRef.current

    const schedule = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)) }

    // Intro cards — fighters are loaded and visible before the count starts
    setBanner('3'); sfx.tap()
    schedule(800, () => { setBanner('2'); sfx.tap() })
    schedule(1600, () => { setBanner('1'); sfx.tap() })
    schedule(2400, () => { setBanner('FIGHT!'); sfx.bell(true) })
    schedule(3000, () => { setBanner(''); setPhase('fighting') })

    const t0 = 3000 // fight starts after the countdown
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
          fireImpact(iAttack ? 'opp' : 'player', ev.move === 'special' ? 'special' : heavy ? 'heavy' : 'light')
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
          fireImpact(iAttack ? 'opp' : 'player', 'block')
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
  }, [phase, validLog, profile?.id, arenaReady])

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
  const PUNCH_CD = 500 // bread-and-butter punch
  const POWER_COST = 40, POWER_MULT = 1.6 // ⚡ spend meter -> next landed hit amplified
  const DODGE_MS = 600, DODGE_CD = 950
  const [meter, setMeter] = useState(0)
  const [powerArmed, setPowerArmed] = useState(false) // ⚡ next landed hit amplified
  const [telegraph, setTelegraph] = useState(false)
  const [hint, setHint] = useState('')
  const [submitErr, setSubmitErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [endCard, setEndCard] = useState(false)         // ±FP result card, then auto-map
  const [leaveConfirm, setLeaveConfirm] = useState(false) // "leave mid-fight?" modal
  const [awaitingOpp, setAwaitingOpp] = useState(false)
  const [dbgTick, setDbgTick] = useState(0) // re-render the debug HUD
  const showDbg = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
  const liveStarted = useRef(false)
  const channelRef = useRef<ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']> | null>(null)
  const L = useRef({
    startAt: 0, liveAt: 0, over: false, myCd: 0, tapAlt: false,
    comboN: 0, lastHit: 0,
    blockHeld: false,
    dodgeUntil: 0, dodgeCd: 0,
    foeNextAt: 0, foeWindupAt: 0, foeMove: 'jab' as Move,
    synced: false, ghost: false, attackSeq: 0,
    // H2H reliability: retry/dedupe + debug trail
    pendingMove: null as null | { seq: number; payload: any; at: number; resent: boolean },
    seenMoves: new Map<number, any>(),
    dbg: { status: 'boot', presence: '', lastRecvAt: 0, sent: 0, recv: 0, note: '' },
    lastResult: { won: false },
    counts: { taps: 0, kicks: 0, jumpkicks: 0, blocks: 0, combos: 0, specials: 0 },
    myHp: 100, foeHp: 100, meter: 0, powerArmed: false,
    // positional combat: fighter positions + guard state (mirrored from React)
    playerX: -ANCHOR, oppX: ANCHOR, blocking: false, ducking: false, airborne: false, foeSpaceUntil: 0,
  })
  const foeStats = fighterStats(foeLevel)
  const myRole = isChallenger ? 'c' : 'd'

  function flashHint(msg: string) {
    setHint(msg)
    setTimeout(() => setHint(''), 1400)
  }

  // The SYNCED 3-2-1: fired on BOTH clients by the same presence event the
  // moment both players are in the ring — one shared countdown, then the
  // bell. The clock and inputs stay locked until startAt (Michael: the
  // countdowns weren't synced — each client used to run its own on arrival).
  function beginSyncedCountdown(preBanner?: string) {
    const S = L.current
    const lead = preBanner ? 900 : 0
    S.startAt = Date.now() + lead + 3200
    setAwaitingOpp(false)
    if (preBanner) { setBanner(preBanner); sfx.bell(true) }
    const seq: [number, () => void][] = [
      [lead, () => { setBanner('3'); sfx.tap() }],
      [lead + 800, () => { setBanner('2'); sfx.tap() }],
      [lead + 1600, () => { setBanner('1'); sfx.tap() }],
      [lead + 2400, () => { setBanner('FIGHT!'); sfx.bell(true) }],
      [lead + 3200, () => setBanner('')],
    ]
    for (const [ms, fn] of seq) timersRef.current.push(setTimeout(fn, ms))
  }

  // Live-fight intro. Bot fights: local 3-2-1 then hand over control.
  // REALTIME fights: no local countdown — straight into the ring (lobby
  // overlay), the shared countdown fires when both players are present.
  useEffect(() => {
    // guests have NO profile — requiring one froze every guest in the intro
    // forever (fighters visible, fight never started, owner waited on a
    // presence that could never come). guest || profile lets them through.
    if (!isLive || phase !== 'intro' || liveStarted.current || (!profile && !guest) || !arenaReady) return
    liveStarted.current = true
    if (realtime) {
      L.current.liveAt = Date.now()
      setPhase('live') // lobby shows; beginSyncedCountdown() runs on sync
      return
    }
    setBanner('3'); sfx.tap()
    const t1 = setTimeout(() => { setBanner('2'); sfx.tap() }, 800)
    const t2 = setTimeout(() => { setBanner('1'); sfx.tap() }, 1600)
    const t3 = setTimeout(() => { setBanner('FIGHT!'); sfx.bell(true) }, 2400)
    const t4 = setTimeout(() => {
      setBanner('')
      L.current.liveAt = Date.now()
      // Bot fight: clock starts now and the AI wakes up
      L.current.startAt = Date.now()
      L.current.foeNextAt = Date.now() + 1600
      setPhase('live')
    }, 3000)
    timersRef.current.push(t1, t2, t3, t4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, phase, profile?.id, guest, arenaReady])

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

    const applyIncomingAttack = (p: { seq: number; move: Move; right?: boolean; boost?: number }) => {
      if (S.over) return
      S.dbg.recv++; S.dbg.lastRecvAt = Date.now()
      // duplicate (their retry): our result broadcast was lost — resend it
      if (S.seenMoves.has(p.seq)) {
        chRef.ch?.send({ type: 'broadcast', event: 'result', payload: S.seenMoves.get(p.seq) })
        return
      }
      const def = MOVES.find(m => m.move === p.move)!
      const heavy = def.mult > 1
      const now = Date.now()
      setFoePose(MOVE_POSE[p.move]); setFoeAttacking(true)
      if (p.move === 'kick' || p.move === 'hook' || p.move === 'jumpkick') foeKick(p.move !== 'hook') // 3D: aimed kick
      else foeJab(!!p.right) // 3D: right or left jab
      setTimeout(() => { if (!L.current.over) { setFoePose('idle'); setFoeAttacking(false) } }, 280)
      setMoveText(`${theirUsername?.toUpperCase() ?? 'FOE'}: ${MOVE_LABELS[p.move]}`)
      // their SPECIAL is an event on OUR screen too: party flash + punch-in
      if (p.move === 'special') { flashSpecial(theirColor); setZoom(true); setTimeout(() => setZoom(false), 700) }

      let result: 'hit' | 'blocked' | 'dodged' = 'hit'
      let dmg = 0
      const reach = (p.move === 'kick' || p.move === 'hook' || p.move === 'jumpkick') ? KICK_RANGE : PUNCH_RANGE
      const outOfRange = dist(S.oppX, S.playerX) > reach
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
        fireImpact('player', 'block')
        sfx.block(); buzz(15)
      } else {
        dmg = strikeDamage(foeLevel, def.mult)
        if (p.boost) { dmg = Math.floor(dmg * p.boost); addSpark(false, '⚡ POWER!', '#fde047') } // their armed power buff
        setMyPose('hit'); reel(false); addBurst(false, heavy)
        addSpark(false, `-${dmg}`, '#f87171')
        fireImpact('player', p.move === 'special' ? 'special' : heavy ? 'heavy' : 'light')
        // heavies knock the body back farther — the number pops AND the fighter moves
        setPlayerHitKey(k => k + 1); S.playerX = Math.max(-2.6, S.playerX - (heavy ? 0.18 : 0.1)); setPlayerX(S.playerX) // 3D flinch + knockback
        contactJuice(heavy || dmg >= 10)
        if (p.move === 'special') triggerHitStop(220) // specials freeze the frame longest
        if (p.move === 'kick' || p.move === 'jumpkick' || p.move === 'hook') sfx.kick()
        else sfx.punch(heavy)
        setShake(true); setTimeout(() => setShake(false), 170)
        setTimeout(() => { if (!L.current.over && !L.current.blockHeld) setMyPose('idle') }, 240)
      }
      const t = S.startAt ? (now - S.startAt) / 1000 : 0
      if (dmg >= S.myHp && t < 14) dmg = Math.max(0, S.myHp - 1) // no KO before 14s
      S.myHp = Math.max(0, S.myHp - dmg)
      setMyHp(S.myHp)
      const resultPayload = { seq: p.seq, result, dmg, hp: S.myHp }
      S.seenMoves.set(p.seq, resultPayload)
      chRef.ch?.send({ type: 'broadcast', event: 'result', payload: resultPayload })
      if (S.myHp === 0) endFight(false, true)
    }

    const applyMyAttackResult = (p: { seq: number; result: 'hit' | 'blocked' | 'dodged'; dmg: number; hp: number }) => {
      if (S.over) return
      S.dbg.recv++; S.dbg.lastRecvAt = Date.now()
      // which move this result confirms (for special-sized impact FX) — must be
      // read BEFORE the pending slot is cleared
      const sentMove = S.pendingMove?.seq === p.seq ? S.pendingMove.payload.move : undefined
      if (S.pendingMove && S.pendingMove.seq === p.seq) S.pendingMove = null
      S.foeHp = Math.max(0, Math.min(100, p.hp))
      setFoeHp(S.foeHp)
      // ⚡ POWER is consumed by the first successful contact
      if (p.result === 'hit' && S.powerArmed) { S.powerArmed = false; setPowerArmed(false) }
      if (p.result === 'hit') {
        setFoePose('hit'); reel(true); addBurst(true, p.dmg >= 10)
        sfx.punch(p.dmg >= 10) // confirm SFX the moment the H2H result lands
        contactJuice(p.dmg >= 10)
        if (sentMove === 'special') triggerHitStop(220) // my special connected — longest stop
        addSpark(true, `-${p.dmg}`, '#facc15')
        fireImpact('opp', sentMove === 'special' ? 'special' : p.dmg >= 10 ? 'heavy' : 'light')
        setOppHitKey(k => k + 1); S.oppX = Math.min(1.8, S.oppX + (p.dmg >= 10 ? 0.18 : 0.1)); setOppX(S.oppX) // 3D flinch + knockback
        S.meter = Math.min(100, S.meter + p.dmg * 1.7)
        setMeter(S.meter)
        if (p.dmg >= 10) { bumpCrowd(); sfx.crowd(0.3) }
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 240)
      } else if (p.result === 'blocked') {
        setFoePose('block')
        addSpark(true, 'BLOCK', '#93c5fd'); sfx.block()
        fireImpact('opp', 'block')
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 300)
      } else {
        setFoePose('dodge')
        addSpark(true, 'MISS', '#9ca3af'); sfx.whoosh()
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 300)
      }
      if (S.foeHp === 0) endFight(true, true)
    }

    const wire = (c: typeof ch) => c
      .on('broadcast', { event: 'move' }, ({ payload }) => applyIncomingAttack(payload))
      .on('broadcast', { event: 'result' }, ({ payload }) => applyMyAttackResult(payload))
      // opponent's position (mirrored: their left-side X → our right-side X)
      .on('broadcast', { event: 'pos' }, ({ payload }) => { S.dbg.lastRecvAt = Date.now(); S.oppX = -payload.x; setOppX(-payload.x) })
      .on('broadcast', { event: 'blk' }, ({ payload }) => { S.dbg.lastRecvAt = Date.now(); setOppBlocking(!!payload.on) })
      .on('presence', { event: 'sync' }, () => {
        const roles = Object.keys(c.presenceState())
        S.dbg.presence = roles.join(',')
        setDbgTick(t => t + 1)
        const both = roles.includes('c') && roles.includes('d')
        if (both && !S.synced && !S.ghost) {
          S.synced = true
          // both clients see this same presence event → one SHARED 3-2-1
          beginSyncedCountdown()
        } else if (both && S.ghost) {
          // opponent arrived AFTER the ghost stepped in. If the ghost fight is
          // still fresh (no damage either way), upgrade to the REAL fight.
          const fresh = S.myHp === 100 && S.foeHp === 100
          if (fresh) {
            S.ghost = false; S.synced = true
            S.foeWindupAt = 0; S.foeNextAt = 0
            setTelegraph(false)
            S.dbg.note = 'ghost->real upgrade'
            beginSyncedCountdown((theirUsername?.toUpperCase() ?? 'OPPONENT') + ' IS HERE!')
          } else {
            S.dbg.note = 'opp arrived too late - staying ghost'
            console.warn('[pvp] opponent presence arrived after ghost fight progressed; staying ghost')
          }
        }
      })

    // reconnect-aware subscribe: recreate the channel if the socket drops.
    // (Phone lock / network blips kill it silently — the #1 H2H failure.)
    const chRef = { ch }
    let retries = 0
    let disposed = false
    const makeChannel = () => supabase.channel(`fight-${challengeId}`, {
      config: { presence: { key: myRole }, broadcast: { self: false } },
    })
    const subscribe = (c: typeof ch) => c.subscribe(async status => {
      S.dbg.status = status
      setDbgTick(t => t + 1)
      if (status === 'SUBSCRIBED') {
        retries = 0
        await c.track({ at: Date.now() })
        // refresh the opponent's view of us after a (re)join
        c.send({ type: 'broadcast', event: 'pos', payload: { x: S.playerX } })
      } else if (!disposed && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
        console.warn('[pvp] channel', status, '- reconnecting')
        S.dbg.note = 'reconnect after ' + status
        try { supabase.removeChannel(chRef.ch) } catch {}
        const delay = Math.min(4000, 500 * 2 ** retries++)
        setTimeout(() => {
          if (disposed || L.current.over) return
          const next = makeChannel()
          chRef.ch = next
          channelRef.current = next
          subscribe(wire(next))
        }, delay)
      }
    })
    subscribe(wire(ch))

    // waking the app (screen unlock, tab switch) forces a health check
    const onVis = () => {
      if (document.visibilityState !== 'visible' || disposed) return
      if (S.dbg.status !== 'SUBSCRIBED') {
        S.dbg.note = 'visible: forcing reconnect'
        try { supabase.removeChannel(chRef.ch) } catch {}
        const next = makeChannel()
        chRef.ch = next
        channelRef.current = next
        subscribe(wire(next))
      }
    }
    document.addEventListener('visibilitychange', onVis)

    // move-retry loop: a lost 'move' broadcast otherwise vanishes silently
    const retryIv = setInterval(() => {
      const pm = S.pendingMove
      if (!pm || S.over) return
      const age = Date.now() - pm.at
      if (age > 1400 && !pm.resent) {
        pm.resent = true
        S.dbg.note = 'retrying move #' + pm.seq
        chRef.ch?.send({ type: 'broadcast', event: 'move', payload: pm.payload })
      } else if (age > 3500) {
        S.pendingMove = null
        S.dbg.note = 'move #' + pm.seq + ' lost (no result)'
        console.warn('[pvp] no result for move', pm.seq)
      }
    }, 400)

    if (!S.synced) setAwaitingOpp(true)

    return () => {
      disposed = true
      clearInterval(retryIv)
      document.removeEventListener('visibilitychange', onVis)
      channelRef.current = null
      supabase.removeChannel(chRef.ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, realtime, challengeId])

  function foeInterval() {
    const base = Math.max(950, 2300 - foeLevel * 70)
    // top-skill bots swing ~30% faster; low-skill ~10% slower
    const skillMult = 1.1 - foeSkill * 0.4
    return base * skillMult * (0.75 + Math.random() * 0.5)
  }

  // After a live fight settles: show the ±FP card for ~3s, then unlock the
  // orientation and REPLACE to the map (back must not reopen the fight).
  function beginEndCard() {
    setEndCard(true)
    setTimeout(() => {
      try { (screen.orientation as any)?.unlock?.() } catch {}
      router.replace('/map')
    }, 3000)
  }

  // Leaving mid-fight always asks first (Confirm = leave, existing
  // no-show/abandon rules settle the fight)
  function confirmLeave() {
    L.current.over = true
    setLeaveConfirm(false)
    try { (screen.orientation as any)?.unlock?.() } catch {}
    router.replace('/map')
  }
  // Browser close/refresh mid-fight → native "are you sure"
  useEffect(() => {
    if (phase !== 'live') return
    const onBefore = (e: BeforeUnloadEvent) => { if (!L.current.over) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [phase])
  // Browser BACK mid-fight → our confirm modal (re-push state to stay put)
  useEffect(() => {
    if (phase !== 'live') return
    history.pushState({ pvpFight: true }, '')
    const onPop = () => {
      if (L.current.over) return
      history.pushState({ pvpFight: true }, '')
      setLeaveConfirm(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [phase])

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
    if (guest) {
      // nothing to settle — no account, no stakes. Straight to the pitch.
      setPhase('done')
      return
    }
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
          beginEndCard()
          return
        }
        if (res.status === 409) {
          // Opponent's client already settled it — just show the result
          setSubmitting(false)
          await fetchChallenge()
          setPhase('done')
          beginEndCard()
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

  // ── Attack pad moves ──────────────────────────────────────────────────────
  // Shared guards + cooldown claim for every offensive move
  function canStrike(cd: number): boolean {
    const S = L.current
    if (phase !== 'live' || S.over || S.blockHeld || S.blocking) return false
    const now = Date.now()
    if (now < S.myCd || now < S.dodgeUntil) return false
    if (realtime && !S.ghost && !S.synced) { flashHint(`⏳ Waiting for ${theirUsername ?? 'opponent'} to enter...`); return false }
    // shared countdown running — nobody swings before the bell
    if (realtime && !S.ghost && S.synced && Date.now() < S.startAt) { return false }
    S.myCd = now + cd
    return true
  }

  // Core: play the 3D move, then resolve damage + spark + SFX ON THE STRIKE
  // FRAME (impactMs = when the clip's punch/kick visually lands), so what you
  // see, hear, and score are one moment — not a disconnected timeout.
  function strikeCore(move: Move, right: boolean, label: string, impactMs: number) {
    const S = L.current
    S.lastHit = Date.now()
    S.counts.taps++
    const heavy = (MOVES.find(m => m.move === move)?.mult ?? 0.6) > 1.0
    const kicky = move === 'kick' || move === 'hook' || move === 'jumpkick'
    buzz(8) // immediate tactile press feedback; the visual pose changes this frame
    sfx.whoosh() // local swing SFX (H2H confirm thud lands on result)
    setMyPose(MOVE_POSE['jab']); setMyAttacking(true)
    if (kicky) myKick(move === 'kick') // 3D: real kick clip, aimed high (head) or low (legs)
    else myJab(right)   // 3D: right = power straight clip, left = jab clip
    setTimeout(() => { if (!L.current.over) { setMyPose('idle'); setMyAttacking(false) } }, 280)
    setMoveText(`YOU: ${label}`)

    if (realtime && !S.ghost) {
      const seq = ++S.attackSeq
      const payload = { seq, move, right, boost: S.powerArmed ? POWER_MULT : undefined }
      S.pendingMove = { seq, payload, at: Date.now(), resent: false }
      S.dbg.sent++
      channelRef.current?.send({ type: 'broadcast', event: 'move', payload })
      return
    }

    // AI mode: everything lands together at the animation's strike frame
    setTimeout(() => {
      if (S.over) return
      // Contact-based: the strike only lands if the fist/foot can VISUALLY
      // reach the opponent (kicks reach farther than punches)
      if (dist(S.playerX ?? -1, S.oppX ?? 1) > (kicky ? KICK_RANGE : PUNCH_RANGE)) {
        addSpark(true, 'WHIFF', '#9ca3af'); sfx.whoosh()
        return
      }
      const mult = MOVES.find(m => m.move === move)!.mult
      const roll = Math.random()
      let result: 'hit' | 'blocked' | 'dodged' = 'hit'
      if (roll < foeStats.dodgeChance) result = 'dodged'
      else if (roll < foeStats.dodgeChance + foeStats.blockChance) result = 'blocked'
      let dmg = 0
      if (result !== 'dodged') {
        dmg = strikeDamage(myLevel, mult)
        if (result === 'blocked') dmg = Math.max(1, Math.floor(dmg * 0.25))
      }
      // ⚡ POWER: armed boost amplifies the next SUCCESSFUL contact, then clears
      if (result === 'hit' && S.powerArmed) {
        dmg = Math.floor(dmg * POWER_MULT)
        S.powerArmed = false; setPowerArmed(false)
        addSpark(true, '⚡ POWER!', '#fde047')
      }
      const t = (Date.now() - S.startAt) / 1000
      if (dmg >= S.foeHp && t < 14) dmg = Math.max(0, S.foeHp - 1) // no KO before 14s
      S.foeHp = Math.max(0, S.foeHp - dmg)
      setFoeHp(S.foeHp)
      if (result === 'hit') {
        setFoePose('hit'); reel(true); addBurst(true, heavy)
        contactJuice(heavy || dmg >= 10)
        if (move === 'special') triggerHitStop(220) // special connected — longest stop
        addSpark(true, `-${dmg}`, '#facc15')
        fireImpact('opp', move === 'special' ? 'special' : heavy ? 'heavy' : 'light')
        setOppHitKey(k => k + 1); S.oppX = Math.min(1.8, S.oppX + (heavy ? 0.18 : 0.1)); setOppX(S.oppX) // 3D flinch + knockback
        if (kicky) sfx.kick(); else sfx.punch(heavy)
        S.meter = Math.min(100, S.meter + dmg * 1.7)
        setMeter(S.meter)
        if (heavy) { bumpCrowd(); sfx.crowd(0.3) }
        setTimeout(() => { if (!L.current.over) setFoePose('idle') }, 240)
      } else if (result === 'blocked') {
        addSpark(true, 'BLOCK', '#93c5fd'); sfx.block()
        fireImpact('opp', 'block')
        setOppBlocking(true); setTimeout(() => { if (!L.current.over) setOppBlocking(false) }, 450)
      } else {
        addSpark(true, 'MISS', '#9ca3af'); sfx.whoosh()
      }
      if (S.foeHp === 0) endFight(true, true)
    }, impactMs)
  }

  // ── Attack pad mapping (diamond): 🦵 high kick N · 🦶 low kick S · 👊 punch E
  //    ⚡ power W (spend meter, buff next contact) · ★ special CENTER ─────────
  // Impact timings match each clip's visible strike frame:
  // straight clip lands ~270ms after press, jab clip ~150ms.
  // Explicit arms (Michael): pad W = left-hand punch, pad E = right-hand punch
  function playerPunchL() {
    if (!canStrike(PUNCH_CD)) return
    strikeCore('cross', false, 'LEFT PUNCH', 150)
  }
  function playerPunchR() {
    if (!canStrike(PUNCH_CD)) return
    strikeCore('cross', true, 'RIGHT PUNCH', 270)
  }
  // keyboard/legacy entry: alternate arms
  function playerPunch() {
    const S = L.current
    const right = (Date.now() - S.lastHit > 700) ? true : !S.tapAlt
    S.tapAlt = right
    if (right) playerPunchR(); else playerPunchL()
  }
  function playerHighKick() {
    if (!canStrike(KICK_CD)) return
    L.current.counts.kicks++
    strikeCore('kick', false, 'HEAD KICK', 260) // Step_in_High_Kick peak lands ~260ms after trigger
  }
  function playerLowKick() {
    if (!canStrike(KICK_CD)) return
    L.current.counts.kicks++
    strikeCore('hook', false, 'LEG KICK', 205) // faster clip (2.3x) — extension lands ~205ms after trigger
  }
  // ⚡ POWER: spends meter to amplify the next successful contact
  function playerPower() {
    const S = L.current
    if (phase !== 'live' || S.over) return
    if (S.powerArmed) { flashHint('⚡ Power is armed — land a hit!'); return }
    if (S.meter < POWER_COST) { flashHint(`⚡ Need ${POWER_COST}% power (land hits to charge)`); return }
    S.meter -= POWER_COST; setMeter(S.meter)
    S.powerArmed = true; setPowerArmed(true)
    flashHint('⚡ POWERED UP — your next hit lands harder!')
    sfx.tap(); buzz(30)
  }
  // ★ SPECIAL: full meter → the big one
  function playerSpecial() {
    const S = L.current
    if (phase !== 'live' || S.over) return
    if (S.meter < 100) { flashHint('★ Fill the yellow power bar for your SPECIAL'); return }
    if (!canStrike(SPECIAL_CD)) return
    S.meter = 0; setMeter(0)
    S.counts.specials++
    setZoom(true); setTimeout(() => setZoom(false), 700)
    flashSpecial(myColor) // full-frame party flash — the special is an EVENT (brief C2)
    strikeCore('special', true, '★ SPECIAL ★', 270)
  }
  // keyboard fallback (desktop): space/enter = punch
  function playerStrike() { playerPunch() }

  // heavy-contact juice: hit-stop + HP shake + screen punch + combo
  function contactJuice(heavy: boolean) {
    triggerHitStop(heavy ? 140 : 85)
    setShake(true)
    setTimeout(() => setShake(false), heavy ? 200 : 130)
    if (heavy) setHpShake(k => k + 1)
    noteComboHit()
    buzz(heavy ? [28, 20, 40] : 18)
  }

  // Game tick: clock, bell, ghost fallback, and the AI foe (bots + no-shows)
  useEffect(() => {
    if (phase !== 'live') return
    const S = L.current
    const iv = setInterval(() => {
      if (S.over) return
      const now = Date.now()

      // Realtime fight not synced yet: freeze the clock and wait. The whole
      // point is TWO REAL PEOPLE fighting (Michael) — the defender is being
      // pulled in from wherever they are, so hold the ring a full 75s for a
      // human before their AI ghost steps in.
      if (realtime && !S.ghost && !S.synced) {
        if (now - S.liveAt > 75_000) {
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
      // clamp at 30: during the shared countdown startAt is in the FUTURE
      setClock(Math.max(0, Math.min(30, Math.ceil(30 - t))))
      if (t >= 30) { endFight(S.myHp > S.foeHp, false); return }

      // AI opponent only (bots / ghosts) — humans attack via the channel
      if (realtime && !S.ghost) return

      // HOLD the guard at the anchor distance. Only move if the player has backed
      // out of range (then close just enough to be in range again) or drifted too
      // close (then re-space). Otherwise stand still in the fighting stance.
      if (!S.foeWindupAt) {
        const gap = dist(S.oppX, S.playerX)
        if (gap > PUNCH_RANGE) {                        // out of punch reach — close in
          const target = (S.playerX ?? -ANCHOR) + PUNCH_RANGE * 0.85
          if (S.oppX > target) { S.oppX = Math.max(target, S.oppX - FOE_STEP); setOppX(S.oppX) }
        } else if (gap < ANCHOR * 1.1) {                // crowding — re-space to mid-range
          // capped at the stage edge so an advancing player can't march the pair off-camera
          const target = Math.min(2.2, (S.playerX ?? -ANCHOR) + ANCHOR * 1.6)
          if (S.oppX < target) { S.oppX = Math.min(target, S.oppX + FOE_STEP); setOppX(S.oppX) }
        }
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
        if (dist(S.oppX ?? 1, S.playerX ?? -1) > PUNCH_RANGE) {
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
          fireImpact('player', 'block')
          sfx.block(); buzz(15)
        } else {
          setMyPose('hit'); reel(false); addBurst(false, heavy)
          addSpark(false, `-${dmg}`, '#f87171')
          fireImpact('player', heavy ? 'heavy' : 'light')
          setPlayerHitKey(k => k + 1); S.playerX = Math.max(-2.6, S.playerX - (heavy ? 0.18 : 0.1)); setPlayerX(S.playerX) // 3D flinch + knockback
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
      } else if (!S.foeWindupAt && now >= S.foeNextAt && dist(S.oppX ?? 1, S.playerX ?? -1) <= PUNCH_RANGE) {
        // Wind up (only when in range): telegraphed — block, duck, or jump back NOW
        S.foeMove = 'jab'
        // skilled bots telegraph for less time — harder to react
        S.foeWindupAt = now + Math.max(320, 650 - foeLevel * 9 - foeSkill * 140)
        setTelegraph(true)
        sfx.tap()
      }
    }, 90)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Live inputs: on-screen pads handle touch; keyboard is the desktop path ──
  useEffect(() => {
    if (phase !== 'live') return
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); playerStrike() }
      if (e.key === 'ArrowDown' || e.key === 's') { L.current.blockHeld = true; setBlocking(true); setMyPose('block') }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 's') {
        L.current.blockHeld = false
        setBlocking(false)
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
          <button onClick={() => router.replace('/map')}
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
          <button onClick={() => router.replace('/map')}
            className="px-6 py-3 bg-gray-800 text-gray-300 rounded-xl font-bold hover:bg-gray-700 transition">
            ← Back to Map
          </button>
        </div>
      </div>
    )
  }

  // guests have no winner_id (nothing settles server-side) — use the local result
  const iWon = guest ? L.current.lastResult?.won === true : challenge?.winner_id === profile?.id
  const fpStake = challenge?.fp_stake ?? 0
  const myColor = myParty === 'democrat' ? '#2563eb' : '#dc2626'
  const theirColor = theirParty === 'democrat' ? '#2563eb' : '#dc2626'
  // lighter partners for the party HP-bar gradients (brief Phase C1)
  const myColorLite = myParty === 'democrat' ? '#60a5fa' : '#f87171'
  const theirColorLite = theirParty === 'democrat' ? '#60a5fa' : '#f87171'

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gray-950 overflow-hidden overscroll-none">
      <div className="battle-wipe" />

      {/* Landscape brawler — ask the player to turn sideways in portrait */}
      {layout === 'landscape' && !landscape && !endCard && (
        <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col items-center justify-center text-center p-8">
          <div className="text-6xl mb-4 animate-pulse">🔄</div>
          <p className="text-white font-black text-xl">Rotate your phone sideways</p>
          <p className="text-gray-400 text-sm mt-2">This is a landscape brawler — turn to fight.</p>
        </div>
      )}

      {/* ══ END CARD: the ±FP hero moment, then auto back to the map ══ */}
      {endCard && (
        <div className="fixed inset-0 z-[110] bg-black/85 flex flex-col items-center justify-center text-center p-6">
          <div className="text-6xl mb-3">{iWon ? '🏆' : '💀'}</div>
          <p className="text-white font-black text-3xl mb-2">{iWon ? 'VICTORY' : 'DEFEAT'}</p>
          <p className={`font-black text-5xl mb-3 ${iWon ? 'text-green-400' : 'text-red-400'}`}
            style={{ textShadow: '0 4px 18px rgba(0,0,0,0.6)' }}>
            {fpStake > 0 ? `${iWon ? '+' : '−'}${fpStake} FP` : 'No FP exchanged'}
          </p>
          <p className="text-gray-400 text-sm">Heading back to the map...</p>
        </div>
      )}

      {/* ══ LEAVE CONFIRM: never silently drop out of a live fight ══ */}
      {leaveConfirm && (
        <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-6">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full text-center">
            <div className="text-4xl mb-2">🚪</div>
            <p className="text-white font-black text-lg mb-1">Leave the fight?</p>
            <p className="text-gray-400 text-sm mb-5">Are you sure? Walking out mid-fight forfeits it.</p>
            <div className="flex gap-3">
              <button onClick={() => setLeaveConfirm(false)}
                className="flex-1 py-3 bg-purple-700 hover:bg-purple-600 text-white rounded-xl font-bold transition">
                Keep Fighting
              </button>
              <button onClick={confirmLeave}
                className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-bold transition">
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ STREET STAGE ══════════════════════════════════════════════════ */}
      {/* LIVE fights are controlled by the on-screen pads (D-pad + attack pad),
          NOT stage taps. Replays: tapping the stage just hypes the crowd. */}
      <div className="relative overflow-hidden select-none flex-1 min-h-0"
        onClick={() => { if (phase === 'fighting') { bumpCrowd(); sfx.crowd(0.35) } }}
        style={{
          animation: shake ? 'sfShake 0.16s linear' : 'none',
          transform: zoom ? 'scale(1.07)' : 'scale(1)',
          transition: 'transform 260ms ease-out',
          background: 'linear-gradient(180deg, #0d0a1e 0%, #221439 38%, #45274b 52%, #2b2b31 60%, #232329 74%, #1a1a1f 100%)',
        }}>

        {/* ONE visual story (PVP_PRESENTATION_BRIEF Phase A1): the 3D arena is
            the only stage. The old CSS street_fight.webp layer + graffiti +
            steam double-exposed a second street behind/below the canvas. */}

        {/* ── HUD: HP bars + clock ── */}
        <div key={hpShake} className="absolute top-3 left-3 right-3 z-20 flex items-start gap-2"
          style={{ animation: hpShake ? 'hpJolt 0.28s ease-out' : undefined }}>
          {/* party chrome (brief Phase C1): head mug + party-colored bar/plate —
              one glance says which corner is which party */}
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              {myHeadId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headSideImage(myHeadId)} alt="" className="h-6 w-6 object-contain shrink-0"
                  style={{ filter: `drop-shadow(0 0 3px ${myColor})` }} />
              )}
              <span className="text-white text-xs font-black truncate">{myUsername ?? 'You'}</span>
              <span className="text-[9px] font-bold px-1 rounded" style={{ background: `${myColor}55`, color: '#fff', border: `1px solid ${myColor}` }}>Lv.{myLevel}</span>
            </div>
            <div className="h-3.5 bg-black/60 rounded-sm overflow-hidden border" style={{ transform: 'skewX(-12deg)', borderColor: `${myColor}88` }}>
              <div className="h-full transition-all duration-300"
                style={{ width: `${myHp}%`, background: `linear-gradient(90deg, ${myColorLite}, ${myColor})` }} />
            </div>
          </div>
          <div className="flex-shrink-0 w-12 h-12 rounded-full border-2 border-white/30 flex items-center justify-center mt-1"
            style={{ background: `linear-gradient(100deg, ${myColor}66 0%, rgba(0,0,0,0.75) 38%, rgba(0,0,0,0.75) 62%, ${theirColor}66 100%)` }}>
            <span className="text-white font-black text-lg tabular-nums">{clock}</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1 justify-end">
              <span className="text-[9px] font-bold px-1 rounded" style={{ background: `${theirColor}55`, color: '#fff', border: `1px solid ${theirColor}` }}>Lv.{foeLevel}</span>
              <span className="text-white text-xs font-black truncate">{theirUsername ?? 'Foe'}</span>
              {oppHeadId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headSideImage(oppHeadId)} alt="" className="h-6 w-6 object-contain shrink-0"
                  style={{ filter: `drop-shadow(0 0 3px ${theirColor})`, transform: 'scaleX(-1)' }} />
              )}
            </div>
            <div className="h-3.5 bg-black/60 rounded-sm overflow-hidden border" style={{ transform: 'skewX(12deg)', borderColor: `${theirColor}88` }}>
              <div className="h-full transition-all duration-300 ml-auto"
                style={{ width: `${foeHp}%`, background: `linear-gradient(90deg, ${theirColor}, ${theirColorLite})` }} />
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

        {/* ★ SPECIAL party-color flash (brief Phase C2) */}
        {specialFlash && (
          <div className="absolute inset-0 z-40 pointer-events-none"
            style={{
              background: `radial-gradient(circle at 50% 45%, ${specialFlash}cc 0%, ${specialFlash}55 55%, transparent 85%)`,
              animation: 'sfKoFlash 0.45s ease-out forwards',
            }} />
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
        {/* pointer-events-none so taps/swipes still reach the stage controller.
            Portrait: the arena stops above the control deck; the follow-cam
            keeps the fighters builder-preview big. */}
        <div className="absolute z-[5] pointer-events-none"
          style={{
            ...(layout === 'portrait' ? { top: 0, left: 0, right: 0, bottom: 200 } : { inset: 0 }),
            // crowd-pop flash now lives on the canvas itself (the CSS street it
            // used to brighten is gone)
            filter: crowdBump ? 'brightness(1.16) saturate(1.08)' : 'none',
            transition: 'filter 130ms ease-out',
          }}>
          <PvpArena3D
            onReady={() => setArenaReady(true)}
            follow={layout === 'portrait'}
            arena={arena}
            impact={impactFx}
            playerTint={myColor}
            oppTint={theirColor}
            playerPrefix={myPvpFighter}
            oppPrefix={oppPvpFighter}
            playerHeadId={myHeadId}
            oppHeadId={oppHeadId}
            playerBlocking={blocking}
            oppBlocking={oppBlocking}
            playerJabRKey={playerJabRKey}
            playerJabLKey={playerJabLKey}
            oppJabRKey={oppJabRKey}
            oppJabLKey={oppJabLKey}
            playerKickHiKey={playerKickHiKey}
            playerKickLoKey={playerKickLoKey}
            oppKickHiKey={oppKickHiKey}
            oppKickLoKey={oppKickLoKey}
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
          <div className="absolute left-3 right-3 z-20 flex items-center gap-2"
            style={{ bottom: layout === 'portrait' ? 208 : 36 }}>
            <div className="flex-1 h-2.5 bg-black/60 rounded-full overflow-hidden border border-white/15">
              <div className="h-full transition-all duration-200"
                style={{ width: `${meter}%`, background: 'linear-gradient(90deg, #f59e0b, #fde047)' }} />
            </div>
          </div>
        )}

        {/* H2H debug HUD: channel status, presence, sync/ghost, traffic */}
        {phase === 'live' && realtime && (showDbg || awaitingOpp) && (() => {
          void dbgTick // re-render driver
          const D = L.current.dbg
          const age = D.lastRecvAt ? Math.round((Date.now() - D.lastRecvAt) / 1000) + 's' : '—'
          return (
            <div className="absolute left-2 z-40 pointer-events-none font-mono text-[9px] leading-tight text-white/80 bg-black/60 rounded-md px-2 py-1"
              style={{ top: 'calc(3.2rem + env(safe-area-inset-top))' }}>
              <div>ch: {D.status} · who: [{D.presence || 'none'}]</div>
              <div>{L.current.synced ? '✅ synced' : '⏳ not synced'}{L.current.ghost ? ' · 👻 GHOST' : ''} · ↑{D.sent} ↓{D.recv} · last rx {age}</div>
              {D.note && <div className="text-yellow-300">{D.note}</div>}
            </div>
          )
        })()}

        {/* foe telegraph — block NOW */}
        {telegraph && (
          <div className="absolute z-20 pointer-events-none" style={{ right: '16%', top: '24%' }}>
            <span className="text-4xl" style={{ animation: 'sfCombo 0.7s ease-out', display: 'inline-block' }}>⚠️</span>
          </div>
        )}

        {/* FIGHT LOBBY (Michael): both corners listed, presence visible —
            the fight auto-starts the moment both players are in */}
        {phase === 'live' && awaitingOpp && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none bg-black/60">
            <div className="w-full max-w-xs mx-4 rounded-3xl border border-purple-500/50 bg-gray-950/95 p-5 text-center shadow-2xl">
              <p className="text-purple-300 text-[10px] font-black tracking-[0.3em]">FIGHT LOBBY</p>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between rounded-xl bg-gray-900 px-4 py-3">
                  <span className="text-white font-black text-sm truncate">{myUsername ?? 'You'}</span>
                  <span className="text-emerald-400 text-[11px] font-black shrink-0">✓ IN THE RING</span>
                </div>
                <p className="text-gray-600 font-black text-xs">VS</p>
                <div className="flex items-center justify-between rounded-xl bg-gray-900 px-4 py-3">
                  <span className="text-white font-black text-sm truncate">{theirUsername ?? 'Opponent'}</span>
                  <span className="text-amber-300 text-[11px] font-black shrink-0 animate-pulse">⏳ ON THE WAY…</span>
                </div>
              </div>
              <p className="text-gray-500 text-[11px] mt-4">The fight starts the second they step in — the ring holds ~75 seconds.</p>
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
          <div className="absolute left-0 right-0 z-20 text-center pointer-events-none"
            style={{ bottom: layout === 'portrait' ? 224 : 8 }}>
            <span className="text-white/80 text-xs font-bold tracking-widest" style={{ textShadow: '0 2px 4px #000' }}>
              {moveText}
            </span>
          </div>
        )}

        {/* ── CONTROLLER PADS (live fights).
            LANDSCAPE: floated over the stage corners (original layout).
            PORTRAIT: docked side-by-side in a bottom control deck — no phone
            rotation needed; the arena's follow-cam keeps fighters big. ── */}
        {phase === 'live' && (() => {
          const base = 'absolute w-11 h-11 rounded-full bg-black/55 border border-white/25 text-white text-lg flex items-center justify-center active:bg-white/30 transition'
          const stop = (e: any) => { e.stopPropagation(); e.preventDefault() }
          const dpad = (
            <div className="relative select-none" style={{ width: 138, height: 138 }}>
              <button title="Jump" className={base} style={{ top: 0, left: 47 }}
                onPointerDown={e => { stop(e); doJump() }}>▲</button>
              <button title="Duck" className={base} style={{ bottom: 0, left: 47 }}
                onPointerDown={e => { stop(e); setPlayerDuck(true) }} onPointerUp={e => { stop(e); setPlayerDuck(false) }} onPointerLeave={() => setPlayerDuck(false)}>▼</button>
              <button title="Back up" className={base} style={{ top: 47, left: 0 }}
                onPointerDown={e => { stop(e); setPlayerX(x => Math.max(-2.6, x - 0.4)) }}>◀</button>
              <button title="Move in" className={base} style={{ top: 47, right: 0 }}
                onPointerDown={e => { stop(e); setPlayerX(x => Math.min((L.current.oppX ?? ANCHOR) - 0.5, x + 0.4)) }}>▶</button>
              <button title="Block" className={`${base} ${blocking ? 'bg-blue-500/70' : ''}`} style={{ top: 47, left: 47 }}
                onPointerDown={e => { stop(e); setBlocking(true) }} onPointerUp={e => { stop(e); setBlocking(false) }} onPointerLeave={() => setBlocking(false)}>🛡</button>
            </div>
          )
          const attack = (
            <div className="relative select-none" style={{ width: 138, height: 138 }}>
              {/* N head kick · S low kick · W LEFT punch · E RIGHT punch ·
                  CENTER special (⚡ power button removed — Michael 2026-07-24) */}
              <button title="Head kick (high)" className={base} style={{ top: 0, left: 47 }}
                onContextMenu={e => e.preventDefault()} onPointerDown={e => { stop(e); playerHighKick() }}>🦵</button>
              <button title="Leg kick (low)" className={base} style={{ bottom: 0, left: 47 }}
                onContextMenu={e => e.preventDefault()} onPointerDown={e => { stop(e); playerLowKick() }}>🦶</button>
              <button title="Left-hand punch" className={base} style={{ top: 47, left: 0 }}
                onContextMenu={e => e.preventDefault()} onPointerDown={e => { stop(e); playerPunchL() }}>🤛</button>
              <button title="Right-hand punch" className={base} style={{ top: 47, right: 0 }}
                onContextMenu={e => e.preventDefault()} onPointerDown={e => { stop(e); playerPunchR() }}>🤜</button>
              <button title="Special (full power bar)"
                className={`${base} ${meter >= 100 ? 'bg-yellow-500/50 border-yellow-300/60 animate-pulse' : ''}`} style={{ top: 47, left: 47 }}
                onContextMenu={e => e.preventDefault()} onPointerDown={e => { stop(e); playerSpecial() }}>★</button>
            </div>
          )
          const swallow = {
            onClick: (e: any) => e.stopPropagation(),
            onTouchStart: (e: any) => e.stopPropagation(),
            onTouchEnd: (e: any) => e.stopPropagation(),
          }
          return layout === 'portrait' ? (
            <div className="absolute left-0 right-0 bottom-0 z-30 pointer-events-auto" {...swallow}
              style={{
                height: 200, paddingBottom: 'env(safe-area-inset-bottom)',
                background: 'linear-gradient(180deg, rgba(6,10,18,0.25) 0%, rgba(6,10,18,0.94) 34%)',
                borderTop: '1px solid rgba(255,255,255,0.09)',
              }}>
              <div className="h-full max-w-md mx-auto flex items-center justify-between px-5">
                {dpad}
                <button onClick={() => setLayout('landscape')}
                  className="text-white/40 hover:text-white/80 text-[10px] font-bold flex flex-col items-center gap-1">
                  <span className="text-base">⤢</span>LANDSCAPE
                </button>
                {attack}
              </div>
            </div>
          ) : (
            <>
              <div className="absolute z-30 pointer-events-auto" {...swallow} style={{ left: 52, bottom: 16 }}>{dpad}</div>
              <div className="absolute z-30 pointer-events-auto" {...swallow} style={{ right: 52, bottom: 16 }}>{attack}</div>
              <button onClick={e => { e.stopPropagation(); setLayout('portrait') }}
                className="absolute z-30 pointer-events-auto text-white/40 hover:text-white/80 text-[10px] font-bold flex flex-col items-center gap-0.5"
                style={{ right: 10, bottom: 60 }}>
                <span className="text-base">⤡</span>VERTICAL
              </button>
            </>
          )
        })()}

        {/* skip hint */}
      </div>

      {/* ══ BELOW THE STAGE ═══════════════════════════════════════════════ */}
      <div className="shrink-0 px-4 py-2 overflow-y-auto" style={{ maxHeight: '38vh' }}>
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
          layout === 'portrait' ? null : (
            <div className="text-center space-y-1">
              <p className="text-white/80 text-xs font-bold">Right pad: 🦵 head kick · 🦶 leg kick · 👊 punch · ★ special</p>
              <p className="text-gray-400 text-[11px]">Left D-pad: ◀ ▶ move · ▲ jump · ▼ duck · 🛡 block — land hits to fill the ⚡ bar</p>
            </div>
          )
        ) : phase !== 'done' ? (
          <p className="text-gray-600 text-xs text-center">🥊 Street fight in progress — one round, 30 seconds</p>
        ) : guest ? (
          /* GUEST post-fight: the sign-up pitch — this fight was the demo */
          <div className="max-w-md mx-auto space-y-3">
            <div className="text-center">
              <div className="text-5xl mb-1">{iWon ? '🏆' : '💀'}</div>
              <h2 className="font-black text-3xl" style={{ color: iWon ? '#22c55e' : '#ef4444' }}>
                {iWon ? 'YOU WON!' : 'DEFEATED!'}
              </h2>
              <p className="text-gray-400 text-sm mt-1">
                {iWon
                  ? `You just dropped ${theirUsername}'s fighter… on autopilot.`
                  : `${theirUsername}'s fighter got you… and that was just the autopilot.`}
              </p>
            </div>
            <a href={`/sign-up?redirect_url=${encodeURIComponent(`/fight/${guestVs ?? challenge?.defender_id ?? ''}`)}`}
              className="block w-full py-4 rounded-2xl font-black text-lg text-white text-center transition active:scale-95"
              style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)', boxShadow: '0 8px 30px rgba(220,38,38,0.4)' }}>
              ⚔️ SIGN UP & KEEP FIGHTING {theirUsername?.toUpperCase()}
            </a>
            <p className="text-gray-500 text-xs text-center">
              They get called out on their phone — live, human vs human, 50 FP on the line. Takes 30 seconds.
            </p>
            <button onClick={() => window.location.reload()}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold transition">
              ↻ Rematch the autopilot
            </button>
            <a href="/" className="block text-center text-gray-600 text-xs font-bold hover:text-gray-400">
              What is PoliticsGo? →
            </a>
          </div>
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

            <button onClick={() => router.replace('/map')}
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
        @keyframes hpJolt { 0%,100% { transform: translate(0,0) } 25% { transform: translate(-5px,2px) } 50% { transform: translate(4px,-2px) } 75% { transform: translate(-2px,1px) } }
        @keyframes sfCombo { 0%{transform:translateX(-50%) scale(0.6);opacity:0} 20%{transform:translateX(-50%) scale(1.2);opacity:1} 80%{transform:translateX(-50%) scale(1);opacity:1} 100%{transform:translateX(-50%) scale(1);opacity:0} }
        @keyframes sfBanner { 0%{transform:scale(2.4);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes sfParticle { 0%{transform:translate(0,0) scale(1);opacity:1} 100%{transform:translate(var(--dx),var(--dy)) scale(0.3);opacity:0} }
        @keyframes sfKoFlash { 0%{opacity:0.9} 100%{opacity:0} }
        @keyframes sfNeon { 0%,100%{opacity:1} 92%{opacity:1} 93%{opacity:0.4} 94%{opacity:1} 96%{opacity:0.6} 97%{opacity:1} }
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

'use client'
import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { type FighterPose } from '@/components/FighterRig'
import FighterSprite from '@/components/FighterSprite'
import { defaultFighter, sanitizeFighter } from '@/lib/fighter'
import type { FighterDesign } from '@/lib/fighter'
import { sfx } from '@/lib/juice'

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
  battle_log: FightLog | null
  challenger_username: string
  defender_username: string
  challenger_party: 'democrat' | 'republican'
  defender_party: 'democrat' | 'republican'
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
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'intro' | 'fighting' | 'done' | 'aborted'>('loading')

  // Fight presentation state
  const [myPose, setMyPose] = useState<FighterPose>('idle')
  const [foePose, setFoePose] = useState<FighterPose>('idle')
  const [myAttacking, setMyAttacking] = useState(false)
  const [foeAttacking, setFoeAttacking] = useState(false)
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
        setPhase(p => (p === 'loading' || p === 'waiting') ? 'intro' : p)
      } else if (data.status === 'pending' || data.status === 'resolving') {
        setPhase('waiting')
      } else {
        setPhase('aborted')
        if (pollRef.current) clearInterval(pollRef.current)
      }
    } catch {}
  }, [challengeId])

  useEffect(() => {
    fetchChallenge()
    pollRef.current = setInterval(fetchChallenge, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchChallenge])

  // Perspective
  const isChallenger = profile && challenge ? challenge.challenger_id === profile.id : true
  const me = isChallenger ? 'c' : 'd'
  const myUsername = isChallenger ? challenge?.challenger_username : challenge?.defender_username
  const theirUsername = isChallenger ? challenge?.defender_username : challenge?.challenger_username
  const myParty = isChallenger ? challenge?.challenger_party : challenge?.defender_party
  const theirParty = isChallenger ? challenge?.defender_party : challenge?.challenger_party

  const log = challenge?.battle_log
  const validLog = log && log.version === 2 && Array.isArray(log.events)
  const myFighter: FighterDesign = validLog
    ? sanitizeFighter(isChallenger ? log!.cFighter : log!.dFighter, profile?.id ?? 'me')
    : defaultFighter(profile?.id ?? 'me')
  const foeFighter: FighterDesign = validLog
    ? sanitizeFighter(isChallenger ? log!.dFighter : log!.cFighter, 'foe')
    : defaultFighter('foe')
  const myLevel = validLog ? (isChallenger ? log!.cLevel : log!.dLevel) : 1
  const foeLevel = validLog ? (isChallenger ? log!.dLevel : log!.cLevel) : 1

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

  // Result sting — once, when the result panel appears
  const stingPlayed = useRef(false)
  useEffect(() => {
    if (phase !== 'done' || stingPlayed.current || !challenge?.winner_id || !profile) return
    stingPlayed.current = true
    if (challenge.winner_id === profile.id) sfx.victory()
    else sfx.defeat()
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
          <div className="text-6xl mb-4">⏳</div>
          <h2 className="text-white font-black text-2xl mb-2">Waiting for opponent...</h2>
          <p className="text-gray-400 text-sm mb-6">
            Waiting for {challenge?.defender_username ?? 'your opponent'} to accept
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
    <div className="min-h-screen flex flex-col bg-gray-950">
      <div className="battle-wipe" />

      {/* ══ STREET STAGE ══════════════════════════════════════════════════ */}
      {/* No tap-anywhere skip: players tap the screen out of PvE habit and
          were fast-forwarding their own fights. Skipping is the ⏭ button —
          stage taps just hype the crowd. */}
      <div className="relative overflow-hidden select-none"
        onClick={() => { if (phase === 'fighting') { bumpCrowd(); sfx.crowd(0.35) } }}
        style={{
          height: '62vh',
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

        {/* ── FIGHTERS ── */}
        <div className="absolute z-10" style={{ left: '8%', bottom: '7%', filter: `drop-shadow(0 0 10px ${myColor}33)` }}>
          <FighterSprite design={myFighter} party={myParty === 'democrat' ? 'democrat' : 'republican'} pose={myPose} facing="right" height={Math.min(300, 260)} attacking={myAttacking} reeling={myReeling} />
          <div className="w-24 h-3 mx-auto -mt-1 rounded-full" style={{ background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)' }} />
        </div>
        <div className="absolute z-10" style={{ right: '8%', bottom: '7%', filter: `drop-shadow(0 0 10px ${theirColor}33)` }}>
          <FighterSprite design={foeFighter} party={theirParty === 'democrat' ? 'democrat' : 'republican'} pose={foePose} facing="left" height={Math.min(300, 260)} attacking={foeAttacking} reeling={foeReeling} />
          <div className="w-24 h-3 mx-auto -mt-1 rounded-full" style={{ background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)' }} />
        </div>

        {/* move ticker */}
        {phase === 'fighting' && moveText && (
          <div className="absolute bottom-2 left-0 right-0 z-20 text-center pointer-events-none">
            <span className="text-white/80 text-xs font-bold tracking-widest" style={{ textShadow: '0 2px 4px #000' }}>
              {moveText}
            </span>
          </div>
        )}

        {/* skip hint */}
      </div>

      {/* ══ BELOW THE STAGE ═══════════════════════════════════════════════ */}
      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {phase !== 'done' ? (
          <p className="text-gray-600 text-xs text-center">🥊 Street fight in progress — one round, 30 seconds</p>
        ) : (
          <div className="max-w-md mx-auto space-y-3">
            <div className="text-center">
              <div className="text-5xl mb-1">{iWon ? '🏆' : '💀'}</div>
              <h2 className="font-black text-3xl" style={{ color: iWon ? '#22c55e' : '#ef4444' }}>
                {iWon ? 'VICTORY!' : 'DEFEATED!'}
              </h2>
              <p className="text-gray-400 text-sm">
                {validLog && (log as FightLog).endedBy === 'bell'
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

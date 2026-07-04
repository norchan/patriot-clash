'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'

interface TurnLog {
  turn: number
  challengerMove: string
  defenderMove: string
  challengerDmg: number
  defenderDmg: number
  challengerHpAfter: number
  defenderHpAfter: number
}

interface ChallengeData {
  id: string
  status: string
  challenger_id: string
  defender_id: string
  winner_id: string
  fp_stake: number
  turns_played: number
  challenger_hp_remaining: number
  defender_hp_remaining: number
  battle_log: TurnLog[]
  challenger_username: string
  defender_username: string
  challenger_party: 'democrat' | 'republican'
  defender_party: 'democrat' | 'republican'
}

interface ChatMessage {
  id: string
  sender_id: string
  content: string
  created_at: string
}

function HpBar({ hp, maxHp = 100 }: { hp: number; maxHp?: number }) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100))
  const color = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444'
  return (
    <div className="h-3 bg-gray-700 rounded-full overflow-hidden w-full">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function Avatar({ party, size = 80, anim }: { party: 'democrat' | 'republican'; size?: number; anim?: string }) {
  const color = party === 'democrat' ? '#2563eb' : '#dc2626'
  const emoji = party === 'democrat' ? '🔵' : '🔴'
  return (
    <div
      style={{
        width: size, height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${color}66, ${color}22)`,
        border: `3px solid ${color}`,
        boxShadow: `0 0 20px ${color}66`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.45,
        animation: anim || 'none',
        flexShrink: 0,
      }}
    >
      {emoji}
    </div>
  )
}

export default function PvpBattlePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const challengeId = searchParams.get('id')
  const { profile, loading: profileLoading } = useProfile()

  const [challenge, setChallenge] = useState<ChallengeData | null>(null)
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'replaying' | 'done'>('loading')

  // Animation state
  const [replayTurn, setReplayTurn] = useState(0)
  const [myHp, setMyHp] = useState(100)
  const [theirHp, setTheirHp] = useState(100)
  const [myAnim, setMyAnim] = useState('')
  const [theirAnim, setTheirAnim] = useState('')
  const [turnText, setTurnText] = useState('')
  const [damageText, setDamageText] = useState<{ me: string; them: string }>({ me: '', them: '' })

  // Chat state
  const [chatEnabled, setChatEnabled] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [otherUsername, setOtherUsername] = useState('')
  const chatRef = useRef<HTMLDivElement>(null)

  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // Inject keyframes once
  useEffect(() => {
    if (document.getElementById('pvp-kf')) return
    const s = document.createElement('style')
    s.id = 'pvp-kf'
    s.textContent = `
      @keyframes pvpIdle   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
      @keyframes pvpAtk    { 0%{transform:translate(0,0) scale(1)} 30%{transform:translate(180px,-40px) scale(1.25)} 60%{transform:translate(20px,-10px) scale(1.05)} 100%{transform:translate(0,0) scale(1)} }
      @keyframes pvpAtkRev { 0%{transform:translate(0,0) scale(1)} 30%{transform:translate(-180px,-40px) scale(1.25)} 60%{transform:translate(-20px,-10px) scale(1.05)} 100%{transform:translate(0,0) scale(1)} }
      @keyframes pvpHit    { 0%,100%{filter:brightness(1)} 15%{filter:brightness(3) saturate(0)} 40%{filter:brightness(1.5)} }
      @keyframes pvpShake  { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
      @keyframes pvpFloat  { 0%{transform:translateY(0);opacity:1} 100%{transform:translateY(-40px);opacity:0} }
      @keyframes pvpWin    { 0%{transform:scale(1) rotate(0deg)} 25%{transform:scale(1.25) rotate(-5deg)} 75%{transform:scale(1.25) rotate(5deg)} 100%{transform:scale(1) rotate(0deg)} }
      @keyframes pvpLose   { 0%{transform:scale(1) rotate(0deg)} 100%{transform:scale(0.7) rotate(20deg); opacity:0.4} }
    `
    document.head.appendChild(s)
    return () => { document.getElementById('pvp-kf')?.remove() }
  }, [])

  const fetchChallenge = useCallback(async () => {
    if (!challengeId) return
    try {
      const res = await fetch(`/api/pvp/${challengeId}`)
      if (!res.ok) return
      const data: ChallengeData = await res.json()
      setChallenge(data)
      if (data.status === 'completed') {
        setPhase('replaying')
        if (pollRef.current) clearInterval(pollRef.current)
      } else if (data.status === 'pending') {
        setPhase('waiting')
      } else {
        setPhase('done')
      }
    } catch {}
  }, [challengeId])

  // Initial load + polling while pending
  useEffect(() => {
    fetchChallenge()
    pollRef.current = setInterval(fetchChallenge, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchChallenge])

  // Determine perspective (am I challenger or defender?)
  const isChallenger = profile && challenge ? challenge.challenger_id === profile.id : true
  const myUsername   = isChallenger ? challenge?.challenger_username : challenge?.defender_username
  const myParty      = isChallenger ? challenge?.challenger_party    : challenge?.defender_party
  const theirUsername = isChallenger ? challenge?.defender_username  : challenge?.challenger_username
  const theirParty    = isChallenger ? challenge?.defender_party     : challenge?.challenger_party

  // Replay animation sequence
  useEffect(() => {
    if (phase !== 'replaying' || !challenge?.battle_log?.length || !profile) return

    const log = challenge.battle_log
    let turn = 0

    function playTurn() {
      if (turn >= log.length) {
        setPhase('done')
        return
      }

      const t = log[turn]
      // From my perspective: "my damage" is what I deal, "their damage" is what they take back
      const myDmg    = isChallenger ? t.challengerDmg : t.defenderDmg
      const theirDmg = isChallenger ? t.defenderDmg   : t.challengerDmg
      const myHpAfter    = isChallenger ? t.challengerHpAfter : t.defenderHpAfter
      const theirHpAfter = isChallenger ? t.defenderHpAfter   : t.challengerHpAfter
      const myMove    = isChallenger ? t.challengerMove : t.defenderMove
      const theirMove = isChallenger ? t.defenderMove   : t.challengerMove

      // Phase 1: I attack
      setTurnText(`Turn ${t.turn} — You: ${myMove}`)
      setMyAnim('pvpAtk 0.7s ease-in-out forwards')
      setTheirAnim('pvpHit 0.5s ease-out 0.3s forwards')
      setDamageText(prev => ({ ...prev, them: `-${theirDmg}` }))
      setTimeout(() => setDamageText(prev => ({ ...prev, them: '' })), 1000)

      // Phase 2: They attack
      setTimeout(() => {
        setTurnText(`Turn ${t.turn} — Foe: ${theirMove}`)
        setTheirAnim('pvpAtkRev 0.7s ease-in-out forwards')
        setMyAnim('pvpHit 0.5s ease-out 0.3s forwards')
        setDamageText(prev => ({ ...prev, me: `-${theirDmg}` }))
        setTimeout(() => setDamageText(prev => ({ ...prev, me: '' })), 1000)
      }, 900)

      // Phase 3: Update HP bars
      setTimeout(() => {
        setMyHp(myHpAfter)
        setTheirHp(theirHpAfter)
        setMyAnim(`pvpIdle 2s ease-in-out infinite`)
        setTheirAnim(`pvpIdle 2s ease-in-out infinite 0.4s`)
      }, 1500)

      // Advance
      setTimeout(() => {
        turn++
        playTurn()
      }, 2000)
    }

    // Set initial idle animations
    setMyAnim('pvpIdle 2s ease-in-out infinite')
    setTheirAnim('pvpIdle 2s ease-in-out infinite 0.4s')
    setTurnText('⚔️ Battle begins...')

    const startTimer = setTimeout(playTurn, 1000)
    return () => clearTimeout(startTimer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, challenge, profile])

  // Fetch chat after battle done
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

  // Poll messages every 4s when chat is open
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
      if (data.message) {
        setMessages(prev => [...prev, data.message])
        setChatInput('')
      }
    } catch {}
    setChatLoading(false)
  }

  if (profileLoading || phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⚔️</div>
          <p className="text-gray-400">Loading battle...</p>
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
            Waiting for {challenge?.defender_username ?? 'your opponent'} to accept the challenge
          </p>
          <div className="flex gap-2 justify-center mb-6">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"
                style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
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
  const resultColor = iWon ? '#22c55e' : '#ef4444'

  return (
    <div className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(180deg, #0a0015 0%, #0d0d1a 40%, #111827 100%)' }}>

      {/* ── Starfield ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} className="absolute w-px h-px bg-white rounded-full opacity-60"
            style={{
              left: `${(i * 37 + 13) % 100}%`,
              top: `${(i * 53 + 7) % 60}%`,
              animationDelay: `${i * 0.3}s`,
            }} />
        ))}
      </div>

      {/* ── Header ── */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-6 pb-2">
        <button onClick={() => router.push('/map')}
          className="text-gray-500 hover:text-white text-sm transition">
          ← Map
        </button>
        <span className="text-gray-500 text-xs font-mono">PvP Battle</span>
        <div className="w-12" />
      </div>

      {/* ── Arena ── */}
      <div className="relative z-10 flex-1 flex flex-col px-4">

        {/* Opponent row */}
        <div className="flex items-center gap-3 mt-4">
          <div className="relative">
            <div style={{ animation: theirAnim }}>
              <Avatar party={(theirParty ?? 'democrat') as 'democrat' | 'republican'} size={72} />
            </div>
            {damageText.them && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-red-400 font-black text-lg"
                style={{ animation: 'pvpFloat 0.9s ease-out forwards', whiteSpace: 'nowrap' }}>
                {damageText.them}
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-white text-sm font-bold">{theirUsername}</span>
              <span className="text-gray-400 text-xs">{theirHp}/100 HP</span>
            </div>
            <HpBar hp={theirHp} />
          </div>
        </div>

        {/* Battle stage */}
        <div className="flex-1 flex items-center justify-center my-4 relative">
          {/* Ground */}
          <div className="absolute bottom-0 left-0 right-0 h-16 rounded-xl"
            style={{ background: 'linear-gradient(0deg, #1e293b 0%, transparent 100%)' }} />

          {/* VS flash during replay */}
          {phase === 'replaying' && (
            <div className="text-purple-400 font-black text-4xl opacity-30 select-none">VS</div>
          )}

          {/* Result display */}
          {phase === 'done' && (
            <div className="text-center relative z-10">
              <div className="text-7xl mb-2" style={{
                animation: iWon ? 'pvpWin 0.6s ease-in-out 3' : 'pvpLose 1s ease-out forwards',
              }}>
                {iWon ? '🏆' : '💀'}
              </div>
              <div className="font-black text-3xl" style={{ color: resultColor }}>
                {iWon ? 'Victory!' : 'Defeated!'}
              </div>
              <div className="text-gray-400 text-sm mt-1">vs {theirUsername}</div>
              <div className="mt-3 px-6 py-2 rounded-xl border"
                style={{ background: `${resultColor}11`, borderColor: `${resultColor}44` }}>
                <span className="font-black text-2xl" style={{ color: resultColor }}>
                  {iWon ? '+' : '-'}{fpStake} FP
                </span>
                <div className="text-gray-500 text-xs mt-0.5">
                  {challenge?.turns_played} turns
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Turn text */}
        {phase === 'replaying' && (
          <div className="text-center text-gray-300 text-sm font-medium mb-3 min-h-5">
            {turnText}
          </div>
        )}

        {/* My row */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-white text-sm font-bold">You ({myUsername})</span>
              <span className="text-gray-400 text-xs">{myHp}/100 HP</span>
            </div>
            <HpBar hp={myHp} />
          </div>
          <div className="relative">
            <div style={{ animation: myAnim }}>
              <Avatar party={(myParty ?? 'republican') as 'democrat' | 'republican'} size={72} />
            </div>
            {damageText.me && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-red-400 font-black text-lg"
                style={{ animation: 'pvpFloat 0.9s ease-out forwards', whiteSpace: 'nowrap' }}>
                {damageText.me}
              </div>
            )}
          </div>
        </div>

        {/* Done: action buttons */}
        {phase === 'done' && (
          <div className="space-y-2 pb-4">
            <button onClick={() => router.push('/map')}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold transition">
              Back to Map
            </button>
            {!chatEnabled && phase === 'done' && (
              <p className="text-gray-600 text-xs text-center">
                Enable messaging in Profile to chat after battles
              </p>
            )}
          </div>
        )}

        {/* ── Chat panel ── */}
        {phase === 'done' && chatEnabled && (
          <div className="pb-4">
            <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-gray-400 text-xs uppercase tracking-wider">
                  Chat with {otherUsername}
                </p>
              </div>

              {/* Message list */}
              <div ref={chatRef} className="max-h-40 overflow-y-auto p-3 space-y-2">
                {messages.length === 0 ? (
                  <p className="text-gray-600 text-xs text-center py-2">No messages yet — say something!</p>
                ) : messages.map(msg => {
                  const isMe = msg.sender_id === profile?.id
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className="max-w-xs px-3 py-1.5 rounded-xl text-sm"
                        style={{
                          background: isMe ? '#7c3aed' : '#1f2937',
                          color: 'white',
                          borderBottomRightRadius: isMe ? 4 : undefined,
                          borderBottomLeftRadius: isMe ? undefined : 4,
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Input */}
              <div className="flex gap-2 p-3 border-t border-gray-800">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  placeholder="Message..."
                  maxLength={200}
                  className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-600 border border-transparent focus:border-purple-700 transition"
                />
                <button
                  onClick={sendMessage}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white text-sm rounded-xl font-bold transition"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

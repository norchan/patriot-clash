'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Users } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

interface ChatMsg {
  id: string; profile_id: string; content: string; created_at: string
  username: string; avatar_url: string | null; party: 'democrat' | 'republican' | null
}
interface RoomUser {
  id: string; username: string; avatar_url: string | null; party: 'democrat' | 'republican' | null
}

const partyColor = (p: string | null) => p === 'democrat' ? '#60a5fa' : p === 'republican' ? '#f87171' : '#9ca3af'

export default function TownHallChatPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { profile } = useProfile()

  const [cityName, setCityName] = useState('Town Hall')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [users, setUsers] = useState<RoomUser[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const sinceRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const scrollDown = () => requestAnimationFrame(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  })

  useEffect(() => {
    fetch(`/api/gyms/${params.id}`)
      .then(r => r.json())
      .then(d => { if (d.gym?.city_name) setCityName(d.gym.city_name) })
      .catch(() => {})
  }, [params.id])

  const refresh = useCallback(async (incremental: boolean) => {
    try {
      const url = incremental && sinceRef.current
        ? `/api/gyms/${params.id}/chat?since=${encodeURIComponent(sinceRef.current)}`
        : `/api/gyms/${params.id}/chat`
      const res = await fetch(url)
      const d = await res.json()
      if (Array.isArray(d.users)) setUsers(d.users)
      if (d.messages?.length) {
        setMessages(prev => {
          if (!incremental) return d.messages
          const have = new Set(prev.map((m: ChatMsg) => m.id))
          const fresh = d.messages.filter((m: ChatMsg) => !have.has(m.id))
          return fresh.length ? [...prev, ...fresh] : prev
        })
        sinceRef.current = d.messages[d.messages.length - 1].created_at
        scrollDown()
      } else if (!incremental) {
        setMessages([])
      }
    } catch {}
  }, [params.id])

  useEffect(() => {
    refresh(false)
    pollRef.current = setInterval(() => refresh(true), 4000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refresh])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/gyms/${params.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      const d = await res.json()
      if (res.ok) {
        setMessages(prev => [...prev, d.message])
        sinceRef.current = d.message.created_at
        setInput('')
        scrollDown()
      }
    } catch {}
    setSending(false)
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
        <button onClick={() => router.push(`/townhall/${params.id}`)} className="text-gray-400 hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-white font-bold text-base truncate">💬 {cityName} Chat Room</h1>
          <p className="text-gray-500 text-xs">{users.length} {users.length === 1 ? 'person' : 'people'} here now</p>
        </div>
        <button onClick={() => setShowUsers(s => !s)}
          className={`flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg ${showUsers ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
          <Users size={14} /> {users.length}
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-gray-600 text-sm text-center py-16">Room&apos;s quiet — break the ice 👋</p>
            )}
            {messages.map(m => {
              const mine = m.profile_id === profile?.id
              const color = partyColor(m.party)
              return (
                <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  {m.avatar_url
                    ? <img src={m.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0 mt-0.5" />
                    : <div className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5" style={{ background: color }} />}
                  <div className={`max-w-[78%] ${mine ? 'text-right' : ''}`}>
                    <span className="text-[10px] font-bold" style={{ color }}>{mine ? 'You' : m.username}</span>
                    <div className={`inline-block px-3 py-1.5 rounded-2xl text-sm break-words ${mine ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100'}`}>
                      {m.content}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex gap-2 p-3 border-t border-gray-800 bg-gray-900">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder={`Message ${cityName}...`}
              maxLength={300}
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none placeholder-gray-600"
            />
            <button onClick={send} disabled={sending || !input.trim()}
              className="px-5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-40">
              Send
            </button>
          </div>
        </div>

        {/* Who's here — slides in on toggle */}
        {showUsers && (
          <div className="w-40 border-l border-gray-800 bg-gray-900 overflow-y-auto flex-shrink-0">
            <p className="text-gray-500 text-[10px] uppercase tracking-wider px-3 pt-3 pb-1">In the room</p>
            {users.map(u => (
              <button key={u.id}
                onClick={() => u.id !== profile?.id && router.push(`/player/${u.id}`)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800 text-left">
                {u.avatar_url
                  ? <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                  : <div className="w-6 h-6 rounded-full" style={{ background: partyColor(u.party) }} />}
                <span className="text-xs truncate" style={{ color: partyColor(u.party) }}>
                  {u.id === profile?.id ? 'You' : u.username}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

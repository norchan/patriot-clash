'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

interface Msg { id: string; sender_id: string; content: string; created_at: string }

export default function MessageThreadPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.userId as string
  const { profile } = useProfile()

  const [other, setOther] = useState<{ username: string; avatar_url: string | null; party: string | null } | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)

  // Who am I talking to
  useEffect(() => {
    fetch(`/api/players/${userId}/profile`)
      .then(r => r.json())
      .then(d => {
        if (d.profile) setOther({ username: d.profile.username, avatar_url: d.profile.avatar_url, party: d.profile.party })
      })
      .catch(() => {})
  }, [userId])

  // Poll the thread
  useEffect(() => {
    const poll = () => {
      fetch(`/api/chat/${userId}`)
        .then(r => r.json())
        .then(d => { if (d.messages) setMessages(d.messages) })
        .catch(() => {})
    }
    poll()
    const iv = setInterval(poll, 3000)
    return () => clearInterval(iv)
  }, [userId])

  // Stay pinned to the newest message unless the user scrolled up
  useEffect(() => {
    if (stickBottom.current) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
  }, [messages])

  async function send() {
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/chat/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (data.message) {
        setMessages(prev => [...prev, data.message])
        setInput('')
        stickBottom.current = true
      }
    } catch {}
    setSending(false)
  }

  const color = other?.party === 'democrat' ? '#2563eb' : other?.party === 'republican' ? '#dc2626' : '#6b7280'

  return (
    <div className="bg-gray-950 flex flex-col" style={{ height: 'calc(100dvh - 5rem)' }}>
      {/* Header — tap the player to open their profile */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <button onClick={() => router.push(`/player/${userId}`)} className="flex items-center gap-2.5 min-w-0">
          {other?.avatar_url ? (
            <img src={other.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border-2" style={{ borderColor: color }} />
          ) : (
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-base border-2"
              style={{ borderColor: color, background: `${color}22` }}>
              {other?.party === 'democrat' ? '🔵' : other?.party === 'republican' ? '🔴' : '⚪'}
            </div>
          )}
          <span className="text-white font-bold text-sm truncate">{other?.username ?? '...'}</span>
        </button>
      </div>

      {/* Thread */}
      <div ref={boxRef}
        onScroll={() => {
          const el = boxRef.current
          if (el) stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">
            No messages yet — say hi to {other?.username ?? 'them'}! 👋
          </p>
        ) : messages.map(m => {
          const isMe = m.sender_id === profile?.id
          return (
            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[78%] px-3 py-2 rounded-2xl text-sm text-white break-words"
                style={{
                  background: isMe ? '#1d4ed8' : '#1f2937',
                  borderBottomRightRadius: isMe ? 6 : undefined,
                  borderBottomLeftRadius: isMe ? undefined : 6,
                }}>
                {m.content}
                <div className={`text-[9px] mt-0.5 ${isMe ? 'text-blue-300/70 text-right' : 'text-gray-500'}`}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Composer */}
      <div className="flex gap-2 p-3 border-t border-gray-800 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Type a message..."
          maxLength={500}
          className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none placeholder-gray-600 border border-transparent focus:border-blue-700 transition"
        />
        <button onClick={send} disabled={sending || !input.trim()}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded-xl font-bold transition">
          Send
        </button>
      </div>
    </div>
  )
}

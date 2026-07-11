'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

interface ChatMsg {
  id: string; profile_id: string; content: string; created_at: string
  username: string; avatar_url: string | null; party: 'democrat' | 'republican' | null
}

// Public town hall chat room — AOL/Yahoo style. Anyone can read and post.
export default function TownHallChat({ gymId, cityName, myId }: {
  gymId: string; cityName: string; myId: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const sinceRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const scrollDown = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }

  const loadInitial = useCallback(async () => {
    try {
      const res = await fetch(`/api/gyms/${gymId}/chat`)
      const d = await res.json()
      if (d.messages) {
        setMessages(d.messages)
        if (d.messages.length) sinceRef.current = d.messages[d.messages.length - 1].created_at
        scrollDown()
      }
    } catch {}
  }, [gymId])

  const poll = useCallback(async () => {
    if (!sinceRef.current) return
    try {
      const res = await fetch(`/api/gyms/${gymId}/chat?since=${encodeURIComponent(sinceRef.current)}`)
      const d = await res.json()
      if (d.messages?.length) {
        setMessages(prev => {
          const have = new Set(prev.map((m: ChatMsg) => m.id))
          const fresh = d.messages.filter((m: ChatMsg) => !have.has(m.id))
          return fresh.length ? [...prev, ...fresh] : prev
        })
        sinceRef.current = d.messages[d.messages.length - 1].created_at
        scrollDown()
      }
    } catch {}
  }, [gymId])

  useEffect(() => {
    if (!open) return
    loadInitial()
    pollRef.current = setInterval(poll, 4000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open, loadInitial, poll])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/gyms/${gymId}/chat`, {
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

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full py-3 rounded-xl font-bold bg-gray-800 hover:bg-gray-700 text-white transition flex items-center justify-center gap-2">
        💬 Enter {cityName} Chat Room
      </button>
    )
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800/60 border-b border-gray-800">
        <span className="text-white text-sm font-bold">💬 {cityName} Chat Room</span>
        <button onClick={() => setOpen(false)} className="text-gray-400 text-xs">Close</button>
      </div>

      <div ref={scrollRef} className="h-72 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-gray-600 text-xs text-center py-10">No messages yet — say hello 👋</p>
        )}
        {messages.map(m => {
          const mine = m.profile_id === myId
          const color = m.party === 'democrat' ? '#60a5fa' : m.party === 'republican' ? '#f87171' : '#9ca3af'
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              {m.avatar_url
                ? <img src={m.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0 mt-0.5" />
                : <div className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5" style={{ background: color }} />}
              <div className={`max-w-[75%] ${mine ? 'text-right' : ''}`}>
                <span className="text-[10px] font-bold" style={{ color }}>{mine ? 'You' : m.username}</span>
                <div className={`inline-block px-3 py-1.5 rounded-2xl text-sm break-words ${mine ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100'}`}>
                  {m.content}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 p-2 border-t border-gray-800">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder="Say something to the room..."
          maxLength={300}
          className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-600"
        />
        <button onClick={send} disabled={sending || !input.trim()}
          className="px-4 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-40">
          Send
        </button>
      </div>
    </div>
  )
}

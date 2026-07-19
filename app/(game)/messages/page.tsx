'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MessageSquare, Trash2 } from 'lucide-react'

interface Conversation {
  user_id: string
  username: string
  avatar_url: string | null
  party: 'democrat' | 'republican' | null
  last_message: string
  unread?: number
  last_from_me: boolean
  last_at: string
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

export default function MessagesPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () => {
      fetch('/api/chat/conversations')
        .then(r => r.json())
        .then(d => setConversations(d.conversations ?? []))
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [])

  async function deleteConversation(userId: string) {
    if (!confirm('Delete this entire conversation? This clears the whole thread.')) return
    setConversations(prev => prev.filter(c => c.user_id !== userId))
    fetch(`/api/chat/${userId}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-white font-bold text-lg flex items-center gap-2">
          💬 Messages
        </h1>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm text-center py-12">Loading messages...</p>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <MessageSquare size={40} className="text-gray-700 mb-3" />
          <p className="text-gray-400 font-medium">No messages yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Tap a player on the map or visit their profile to start a conversation.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-900">
          {conversations.map(c => {
            const color = c.party === 'democrat' ? '#2563eb' : c.party === 'republican' ? '#dc2626' : '#6b7280'
            return (
              <div key={c.user_id}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-900 transition"
                style={(c.unread ?? 0) > 0 ? {
                  // unopened thread: soft purple wash + edge bar so it pops
                  background: 'linear-gradient(90deg, rgba(124,58,237,0.16), rgba(124,58,237,0.05))',
                  boxShadow: 'inset 3px 0 0 #7c3aed',
                } : undefined}>
                <button onClick={() => router.push(`/messages/${c.user_id}`)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  {c.avatar_url ? (
                    <img src={c.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover border-2 flex-shrink-0"
                      style={{ borderColor: color }} />
                  ) : (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl border-2 flex-shrink-0"
                      style={{ borderColor: color, background: `${color}22` }}>
                      {c.party === 'democrat' ? '🔵' : c.party === 'republican' ? '🔴' : '⚪'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-bold text-sm truncate">{c.username}</span>
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        {(c.unread ?? 0) > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-purple-500 text-white text-[10px] font-black flex items-center justify-center">
                            {c.unread! > 99 ? '99+' : c.unread}
                          </span>
                        )}
                        <span className="text-gray-600 text-[11px]">{timeAgo(c.last_at)}</span>
                      </span>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${(c.unread ?? 0) > 0 ? 'text-gray-200 font-semibold' : 'text-gray-500'}`}>
                      {c.last_from_me ? 'You: ' : ''}{c.last_message}
                    </p>
                  </div>
                </button>
                <button onClick={() => deleteConversation(c.user_id)}
                  className="text-gray-600 hover:text-red-400 p-2 flex-shrink-0 transition" title="Delete conversation">
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

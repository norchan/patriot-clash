'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Bell } from 'lucide-react'

interface Notification {
  id: string
  type: 'dm' | 'pvp' | 'social' | 'system'
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

const TYPE_ICON: Record<string, string> = { dm: '💬', pvp: '⚔️', social: '🗣️', system: '🏛️' }

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

export default function NotificationsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => setItems(d.notifications ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
    // opening the page marks everything read
    fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-white font-bold text-lg">🔔 Notifications</h1>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm text-center py-12">Loading...</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <Bell size={40} className="text-gray-700 mb-3" />
          <p className="text-gray-400 font-medium">Nothing yet</p>
          <p className="text-gray-600 text-sm mt-1">Messages, challenges, and replies will show up here.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-900">
          {items.map(n => (
            <button key={n.id}
              onClick={() => n.link && router.push(n.link)}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left transition ${n.read ? 'opacity-60' : ''} ${n.link ? 'hover:bg-gray-900' : 'cursor-default'}`}>
              <span className="text-xl mt-0.5">{TYPE_ICON[n.type] ?? '🔔'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white text-sm font-bold truncate">{n.title}</span>
                  <span className="text-gray-600 text-[11px] flex-shrink-0">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="text-gray-500 text-xs truncate mt-0.5">{n.body}</p>}
              </div>
              {!n.read && <span className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

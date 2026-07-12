'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

interface BlockedPlayer { id: string; username: string; blocked_at: string }

export default function SettingsPage() {
  const router = useRouter()
  const { profile, loading, refetch } = useProfile()
  const [toggling, setToggling] = useState<string | null>(null)
  const [blockedPlayers, setBlockedPlayers] = useState<BlockedPlayer[]>([])
  const [showBlocked, setShowBlocked] = useState(false)

  async function toggleSetting(key: 'allow_pvp_messages' | 'allow_messages' | 'show_party' | 'show_nsfw', current: boolean) {
    setToggling(key)
    try {
      await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !current }),
      })
      await refetch()
    } catch {}
    setToggling(null)
  }

  async function toggleNotifPref(key: 'dm' | 'pvp' | 'social', val: boolean) {
    setToggling(`notif_${key}`)
    try {
      await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_prefs: { [key]: !val } }),
      })
      await refetch()
    } catch {}
    setToggling(null)
  }

  async function loadBlocked() {
    try {
      const res = await fetch('/api/players/block')
      const data = await res.json()
      setBlockedPlayers(data.blocked ?? [])
      setShowBlocked(true)
    } catch {}
  }

  async function unblock(id: string) {
    try {
      await fetch('/api/players/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked_id: id }),
      })
      setBlockedPlayers(prev => prev.filter(p => p.id !== id))
    } catch {}
  }

  const Toggle = ({ on, onColor = '#22c55e' }: { on: boolean; onColor?: string }) => (
    <div className="ml-3 flex-shrink-0 w-10 h-6 rounded-full relative transition-colors"
      style={{ background: on ? onColor : '#374151' }}>
      <div className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
        style={{ left: on ? 22 : 4 }} />
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-500 text-sm">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-8">
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-white font-bold text-lg">⚙️ Settings</h1>
      </div>

      {/* Map settings link */}
      <div className="mx-4 mt-4">
        <button onClick={() => router.push('/settings/map')}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-gray-900 rounded-2xl border border-gray-800 hover:bg-gray-800 transition">
          <div className="text-left">
            <div className="text-white text-sm font-bold">🗺️ Map Settings</div>
            <div className="text-gray-500 text-xs">Who can see you · location accuracy</div>
          </div>
          <ChevronRight size={18} className="text-gray-600" />
        </button>
      </div>

      {/* Privacy */}
      <div className="mx-4 mt-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Privacy</h3>
        <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
          {([
            { key: 'show_party' as const,        label: 'Show Party Affiliation', sub: 'Others see your party color on the map',            val: profile?.show_party ?? true,        onColor: '#22c55e' },
            { key: 'allow_messages' as const,    label: 'Allow Direct Messages',  sub: 'Other players can send you chat requests',          val: profile?.allow_messages ?? true,    onColor: '#3b82f6' },
            { key: 'allow_pvp_messages' as const, label: 'PvP Battle Chat',       sub: 'Chat after PvP battles (both players must enable)', val: profile?.allow_pvp_messages ?? false, onColor: '#7c3aed' },
          ]).map(({ key, label, sub, val, onColor }) => (
            <button key={key}
              onClick={() => toggleSetting(key, val)}
              disabled={toggling === key}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition border-b border-gray-800 last:border-0 disabled:opacity-50">
              <div className="text-left">
                <div className="text-white text-sm font-medium">{label}</div>
                <div className="text-gray-500 text-xs">{sub}</div>
              </div>
              <Toggle on={val} onColor={onColor} />
            </button>
          ))}
        </div>
      </div>

      {/* Content — 18+ NSFW */}
      <div className="mx-4 mt-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">🔞 Content</h3>
        <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
          <button
            onClick={() => toggleSetting('show_nsfw', (profile as any)?.show_nsfw ?? false)}
            disabled={toggling === 'show_nsfw'}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition disabled:opacity-50">
            <div className="text-left pr-3">
              <div className="text-white text-sm font-medium">Show NSFW Content</div>
              <div className="text-gray-500 text-xs">18+ only. Reveals posts marked NSFW (strong language, nudity) instead of blurring them.</div>
            </div>
            <Toggle on={(profile as any)?.show_nsfw ?? false} onColor="#ec4899" />
          </button>
        </div>
        <p className="text-gray-600 text-[11px] mt-2 px-1">
          PoliticsGo is an 18+ game. Mark your own posts NSFW with the 🔞 button when posting anything explicit.
        </p>
      </div>

      {/* Notifications */}
      <div className="mx-4 mt-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">🔔 Notifications</h3>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          {([
            { key: 'dm' as const,     label: 'Direct Messages',    sub: 'When someone messages you' },
            { key: 'pvp' as const,    label: 'Battle Challenges',  sub: 'When someone challenges you to PvP' },
            { key: 'social' as const, label: 'Comments & Replies', sub: 'When someone responds to your posts' },
          ]).map(({ key, label, sub }) => {
            const val = ((profile as any)?.notification_prefs ?? {})[key] !== false
            return (
              <button key={key}
                onClick={() => toggleNotifPref(key, val)}
                disabled={toggling === `notif_${key}`}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition border-b border-gray-800 last:border-0 disabled:opacity-50">
                <div className="text-left">
                  <div className="text-white text-sm font-medium">{label}</div>
                  <div className="text-gray-500 text-xs">{sub}</div>
                </div>
                <Toggle on={val} />
              </button>
            )
          })}
        </div>
      </div>

      {/* Blocked players */}
      <div className="mx-4 mt-4">
        {!showBlocked ? (
          <button onClick={loadBlocked}
            className="w-full py-3 bg-gray-900 border border-gray-800 rounded-xl text-gray-500 text-sm hover:bg-gray-800 hover:text-gray-300 transition">
            🚫 Manage Blocked Players
          </button>
        ) : (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <span className="text-gray-400 text-xs uppercase tracking-wider">Blocked Players</span>
              <button onClick={() => setShowBlocked(false)} className="text-gray-600 hover:text-gray-400 text-xs">Hide</button>
            </div>
            {blockedPlayers.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-4">No blocked players</p>
            ) : blockedPlayers.map(p => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-800 last:border-0">
                <span className="text-gray-300 text-sm">{p.username}</span>
                <button onClick={() => unblock(p.id)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition font-medium">
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

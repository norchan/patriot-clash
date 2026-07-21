'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import HomeHallPicker from '@/components/HomeHallPicker'

interface BlockedPlayer { id: string; username: string; blocked_at: string }

export default function SettingsPage() {
  const router = useRouter()
  const { profile, loading, refetch } = useProfile()
  const [toggling, setToggling] = useState<string | null>(null)
  const [blockedPlayers, setBlockedPlayers] = useState<BlockedPlayer[]>([])
  const [showBlocked, setShowBlocked] = useState(false)
  const [partyStatus, setPartyStatus] = useState<{ can_change: boolean; days_left: number } | null>(null)
  const [switchingParty, setSwitchingParty] = useState(false)
  const [partyMsg, setPartyMsg] = useState('')

  useEffect(() => {
    fetch('/api/profile/party').then(r => r.json())
      .then(d => setPartyStatus({ can_change: !!d.can_change, days_left: d.days_left ?? 0 }))
      .catch(() => {})
  }, [profile?.party])

  async function switchParty() {
    if (!profile || switchingParty) return
    const to = profile.party === 'democrat' ? 'republican' : 'democrat'
    if (!confirm(`Switch to ${to === 'democrat' ? 'Democrat' : 'Republican'}? This leaves your current clique, and you won't be able to switch again for 30 days.`)) return
    setSwitchingParty(true)
    setPartyMsg('')
    try {
      const res = await fetch('/api/profile/party', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party: to }),
      })
      const d = await res.json()
      if (res.ok) {
        setPartyMsg(`✅ You're now a ${to === 'democrat' ? 'Democrat' : 'Republican'}!`)
        await refetch()
        setPartyStatus({ can_change: false, days_left: 30 })
      } else {
        setPartyMsg(`❌ ${d.error ?? 'Could not switch'}`)
        if (typeof d.days_left === 'number') setPartyStatus({ can_change: false, days_left: d.days_left })
      }
    } catch { setPartyMsg('❌ Could not switch') }
    setSwitchingParty(false)
  }

  async function toggleSetting(key: 'allow_pvp_messages' | 'allow_messages' | 'show_party', current: boolean) {
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

      {/* Party — switchable once every 30 days */}
      <div className="mx-4 mt-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Party</h3>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-white text-sm font-bold flex items-center gap-2">
                <span>{profile?.party === 'democrat' ? '🔵' : '🔴'}</span>
                {profile?.party === 'democrat' ? 'Democrat' : 'Republican'}
              </div>
              <div className="text-gray-500 text-xs mt-0.5">
                {partyStatus && !partyStatus.can_change
                  ? `Switch again in ${partyStatus.days_left} day${partyStatus.days_left !== 1 ? 's' : ''}`
                  : 'You can switch parties once a month'}
              </div>
            </div>
            <button
              onClick={switchParty}
              disabled={switchingParty || (partyStatus ? !partyStatus.can_change : false)}
              className="text-xs font-bold px-3 py-2 rounded-xl text-white transition active:scale-95 disabled:opacity-40"
              style={{ background: profile?.party === 'democrat' ? '#dc2626' : '#2563eb' }}>
              {switchingParty ? '...' : `Switch to ${profile?.party === 'democrat' ? 'Republican' : 'Democrat'}`}
            </button>
          </div>
          {partyMsg && <p className="text-xs mt-3 text-gray-300">{partyMsg}</p>}
        </div>
      </div>

      {/* Gender — used for the Active Players filter */}
      <div className="mx-4 mt-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Profile</h3>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <div className="text-white text-sm font-medium mb-2">Gender</div>
          <div className="flex gap-2">
            {(['male', 'female'] as const).map(g => {
              const active = (profile as any)?.gender === g
              return (
                <button key={g}
                  onClick={async () => {
                    await fetch('/api/profile/settings', {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ gender: active ? null : g }),
                    })
                    await refetch()
                  }}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm transition"
                  style={{ background: active ? '#7c3aed' : 'rgba(255,255,255,0.06)', color: active ? '#fff' : '#9ca3af' }}>
                  {g === 'male' ? '♂ Male' : '♀ Female'}
                </button>
              )
            })}
          </div>
          <p className="text-gray-600 text-[11px] mt-2">Shown to others and used to filter the Active Players list. Tap again to clear.</p>
        </div>
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

      {/* Assigned town hall — everyone has one; cliques override it */}
      <div className="mx-4 mt-4">
        <HomeHallPicker />
      </div>

      {/* Notifications — full control center (per-type + push per device) */}
      <div className="mx-4 mt-4">
        <button onClick={() => router.push('/settings/notifications')}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-gray-900 rounded-2xl border border-gray-800 hover:bg-gray-800 transition">
          <div className="text-left">
            <div className="text-white text-sm font-bold">🔔 Notifications</div>
            <div className="text-gray-500 text-xs">Push notifications · what pings you</div>
          </div>
          <ChevronRight size={18} className="text-gray-600" />
        </button>
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

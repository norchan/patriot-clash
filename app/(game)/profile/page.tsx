'use client'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { useProfile } from '@/hooks/useProfile'
import { LogOut, Zap, Footprints, Swords, Flag } from 'lucide-react'

const RANKS = [
  { title: 'Newcomer',   min: 0,   color: '#6b7280' },
  { title: 'Recruit',    min: 5,   color: '#22c55e' },
  { title: 'Activist',   min: 20,  color: '#3b82f6' },
  { title: 'Campaigner', min: 50,  color: '#8b5cf6' },
  { title: 'Veteran',    min: 100, color: '#f59e0b' },
  { title: 'Commander',  min: 200, color: '#ef4444' },
  { title: 'Legend',     min: 500, color: '#f97316' },
]

export default function ProfilePage() {
  const router = useRouter()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { profile, loading } = useProfile()

  const rank = RANKS.slice().reverse().find(r => (profile?.total_battles_won || 0) >= r.min) || RANKS[0]
  const nextRank = RANKS.find(r => r.min > (profile?.total_battles_won || 0))
  const progressToNext = nextRank
    ? Math.min(100, ((profile?.total_battles_won || 0) - rank.min) / (nextRank.min - rank.min) * 100)
    : 100

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading profile...</div>
      </div>
    )
  }

  const partyColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const partyEmoji = profile?.party === 'democrat' ? '🔵' : '🔴'
  const partyName = profile?.party === 'democrat' ? 'Democrat' : 'Republican'

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      <div className="px-4 pt-8 pb-6" style={{ background: `linear-gradient(180deg, ${partyColor}33 0%, transparent 100%)` }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl border-2"
            style={{ borderColor: partyColor, background: `${partyColor}33` }}>
            {partyEmoji}
          </div>
          <div className="flex-1">
            <h1 className="text-white font-bold text-xl">{profile?.username}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${partyColor}33`, color: partyColor }}>
                {partyName}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${rank.color}22`, color: rank.color }}>
                {rank.title}
              </span>
            </div>
          </div>
          <button onClick={() => signOut(() => router.push('/sign-in'))} className="p-2 text-gray-500 hover:text-gray-300">
            <LogOut size={20} />
          </button>
        </div>
        {nextRank && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{rank.title}</span>
              <span>{nextRank.title} in {nextRank.min - (profile?.total_battles_won || 0)} wins</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progressToNext}%`, background: rank.color }} />
            </div>
          </div>
        )}
      </div>

      <div className="px-4 mt-2">
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: <Zap size={18} className="text-yellow-400" />, label: 'Fighting Points', value: profile?.fp_balance?.toLocaleString() || '0', color: 'text-yellow-400' },
            { icon: <Footprints size={18} className="text-green-400" />, label: 'Total Steps', value: profile?.total_steps?.toLocaleString() || '0', color: 'text-green-400' },
            { icon: <Swords size={18} className="text-blue-400" />, label: 'Battles Won', value: profile?.total_battles_won?.toLocaleString() || '0', color: 'text-blue-400' },
            { icon: <Flag size={18} className="text-purple-400" />, label: 'Halls Captured', value: profile?.total_gyms_captured?.toLocaleString() || '0', color: 'text-purple-400' },
          ].map(({ icon, label, value, color }) => (
            <div key={label} className="bg-gray-900 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">{icon}<span className="text-gray-500 text-xs">{label}</span></div>
              <div className={`font-bold text-2xl ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Battle Record</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-center">
            <div className="text-green-400 font-bold text-2xl">{profile?.total_battles_won || 0}</div>
            <div className="text-gray-500 text-xs">Wins</div>
          </div>
          <div className="text-gray-700 font-bold text-xl">/</div>
          <div className="flex-1 text-center">
            <div className="text-red-400 font-bold text-2xl">{profile?.total_battles_lost || 0}</div>
            <div className="text-gray-500 text-xs">Losses</div>
          </div>
          <div className="text-gray-700 font-bold text-xl">/</div>
          <div className="flex-1 text-center">
            <div className="text-gray-400 font-bold text-2xl">
              {profile?.total_battles_won && profile?.total_battles_lost
                ? Math.round(profile.total_battles_won / Math.max(1, profile.total_battles_won + profile.total_battles_lost) * 100)
                : 0}%
            </div>
            <div className="text-gray-500 text-xs">Win Rate</div>
          </div>
        </div>
      </div>

      <div className="mx-4 mt-3 space-y-2">
        <button onClick={() => router.push('/map')} className="w-full py-3 bg-gray-900 border border-gray-800 rounded-xl text-white text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition">
          🗺️ Back to Map
        </button>
        <button onClick={() => router.push('/collection')} className="w-full py-3 bg-gray-900 border border-yellow-900 rounded-xl text-yellow-400 text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition">
          🎯 My Collection
        </button>
        <button onClick={() => router.push('/shop')} className="w-full py-3 bg-gray-900 border border-gray-800 rounded-xl text-white text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition">
          ⚡ Buy Fighting Points
        </button>
      </div>
    </div>
  )
}
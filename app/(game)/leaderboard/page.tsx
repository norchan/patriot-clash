'use client'
import { useState, useEffect } from 'react'
import { useProfile } from '@/hooks/useProfile'

type LBType = 'fp' | 'wins' | 'gyms' | 'captures'

interface Player {
  id: string
  username: string
  party: 'democrat' | 'republican' | null
  fp_balance: number
  total_battles_won: number
  total_gyms_captured: number
  total_captures: number
}

const TABS: { key: LBType; label: string; emoji: string; getValue: (p: Player) => number; unit: string }[] = [
  { key: 'fp',       label: 'FP',      emoji: '⚡', getValue: p => p.fp_balance,         unit: 'FP' },
  { key: 'wins',     label: 'Wins',    emoji: '⚔️', getValue: p => p.total_battles_won,  unit: 'wins' },
  { key: 'gyms',     label: 'Gyms',    emoji: '🏛️', getValue: p => p.total_gyms_captured, unit: 'gyms' },
  { key: 'captures', label: 'Catches', emoji: '🎯', getValue: p => p.total_captures,      unit: 'caught' },
]

const MEDALS = ['🥇', '🥈', '🥉']

export default function LeaderboardPage() {
  const { profile } = useProfile()
  const [type, setType] = useState<LBType>('fp')
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/leaderboard?type=${type}`)
      .then(r => r.json())
      .then(d => setPlayers(d.players ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [type])

  const tab = TABS.find(t => t.key === type)!
  const myRank = players.findIndex(p => p.id === profile?.id)

  return (
    <div className="min-h-screen bg-gray-950 pb-6">

      {/* Header */}
      <div className="px-4 pt-8 pb-4"
        style={{ background: 'linear-gradient(180deg, rgba(245,158,11,0.18) 0%, transparent 100%)' }}>
        <h1 className="text-white font-black text-2xl mb-1">🏆 Leaderboard</h1>
        <p className="text-gray-500 text-sm">Top 25 players nationwide</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-4 mb-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
            style={{
              background: type === t.key ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${type === t.key ? '#f59e0b88' : 'rgba(255,255,255,0.08)'}`,
              color: type === t.key ? '#f59e0b' : '#6b7280',
            }}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* Your rank banner */}
      {myRank >= 0 && profile && (
        <div className="mx-4 mb-3 rounded-xl px-4 py-3 flex items-center gap-3"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <span className="text-yellow-400 font-black text-lg">#{myRank + 1}</span>
          <span className="text-yellow-400 text-sm font-semibold">Your rank</span>
          <span className="text-yellow-500 text-sm ml-auto font-bold">
            {tab.getValue(players[myRank]).toLocaleString()} {tab.unit}
          </span>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="text-gray-500 text-sm">Loading...</div>
        </div>
      ) : (
        <div className="px-4 space-y-2">
          {players.map((player, i) => {
            const isMe = player.id === profile?.id
            const partyColor = player.party === 'democrat' ? '#2563eb'
              : player.party === 'republican' ? '#dc2626' : '#6b7280'
            const value = tab.getValue(player)

            return (
              <div key={player.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                style={{
                  background: isMe
                    ? 'rgba(245,158,11,0.08)'
                    : i < 3
                    ? 'rgba(255,255,255,0.04)'
                    : 'rgba(255,255,255,0.02)',
                  border: isMe
                    ? '1px solid rgba(245,158,11,0.35)'
                    : i < 3
                    ? '1px solid rgba(255,255,255,0.08)'
                    : '1px solid rgba(255,255,255,0.04)',
                }}
              >
                {/* Rank */}
                <div className="w-8 text-center flex-shrink-0">
                  {i < 3
                    ? <span className="text-xl">{MEDALS[i]}</span>
                    : <span className="text-gray-600 font-bold text-sm">#{i + 1}</span>
                  }
                </div>

                {/* Party dot */}
                <div className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ background: partyColor, boxShadow: `0 0 6px ${partyColor}` }} />

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <span className="text-white font-semibold text-sm truncate block">
                    {player.username}
                    {isMe && <span className="text-yellow-500 text-xs ml-1">(you)</span>}
                  </span>
                  {player.party && (
                    <span className="text-xs capitalize" style={{ color: partyColor }}>
                      {player.party}
                    </span>
                  )}
                </div>

                {/* Value */}
                <div className="text-right flex-shrink-0">
                  <div className="text-white font-black text-base">{value.toLocaleString()}</div>
                  <div className="text-gray-600 text-xs">{tab.unit}</div>
                </div>
              </div>
            )
          })}

          {players.length === 0 && (
            <div className="text-center py-12 text-gray-600">
              No players yet — be the first!
            </div>
          )}
        </div>
      )}
    </div>
  )
}

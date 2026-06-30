'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLocation } from '@/hooks/useLocation'
import { useProfile } from '@/hooks/useProfile'

interface Gym {
  id: string
  city_name: string
  state: string
  county: string
  holder_party: 'democrat' | 'republican' | null
  holder_username: string | null
  defense_points: number
  distance_miles: string
  population: number
}

export default function TownHallIndexPage() {
  const router = useRouter()
  const { location, loading: locationLoading } = useLocation()
  const { profile } = useProfile()
  const [gyms, setGyms] = useState<Gym[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!location) return
    fetch(`/api/gyms?lat=${location.lat}&lng=${location.lng}`)
      .then(r => r.json())
      .then(data => {
        setGyms(data.gyms || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [location])

  if (locationLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🏛️</div>
          <p className="text-gray-400">Finding nearby Town Halls...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b border-gray-800">
        <h1 className="text-white font-bold text-2xl">Town Halls</h1>
        <p className="text-gray-500 text-sm mt-1">
          {gyms.length} within 100 miles of you
        </p>
      </div>

      {/* Gym list */}
      <div className="px-4 mt-4 space-y-3">
        {gyms.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">📍</div>
            <p className="text-gray-400">No Town Halls found nearby.</p>
            <p className="text-gray-600 text-sm mt-2">Make sure location is enabled.</p>
          </div>
        )}

        {gyms.map(gym => {
          const isHeld = !!gym.holder_username
          const isEnemy = isHeld && gym.holder_party !== profile?.party
          const isFriendly = isHeld && gym.holder_party === profile?.party
          const partyColor = gym.holder_party === 'democrat' ? '#2563eb' : gym.holder_party === 'republican' ? '#dc2626' : '#6b7280'
          const flagEmoji = gym.holder_party === 'democrat' ? '🔵' : gym.holder_party === 'republican' ? '🔴' : '⚪'

          return (
            <button
              key={gym.id}
              onClick={() => router.push(`/townhall/${gym.id}`)}
              className="w-full bg-gray-900 border border-gray-800 rounded-2xl p-4 text-left hover:border-gray-700 transition active:scale-98"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ background: `${partyColor}22`, border: `1px solid ${partyColor}44` }}
                >
                  {flagEmoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm truncate">
                      {gym.city_name}, {gym.state}
                    </span>
                    {isEnemy && (
                      <span className="text-xs bg-red-900 text-red-300 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        Enemy
                      </span>
                    )}
                    {isFriendly && (
                      <span className="text-xs bg-green-900 text-green-300 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        Friendly
                      </span>
                    )}
                    {!isHeld && (
                      <span className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        Unclaimed
                      </span>
                    )}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {gym.holder_username ? `Held by ${gym.holder_username}` : 'No holder yet'}
                    {' · '}
                    {gym.distance_miles} mi away
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-gray-400 text-xs">Defense</div>
                  <div className="text-white text-sm font-bold">{gym.defense_points}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
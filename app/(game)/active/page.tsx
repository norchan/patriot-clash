'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Radar } from 'lucide-react'
import { useLocation } from '@/hooks/useLocation'
import { useProfile } from '@/hooks/useProfile'

interface NearbyPlayer {
  profile_id: string
  username: string
  party: 'democrat' | 'republican' | null
  lat: number
  lng: number
  avatar_url: string | null
  approx?: boolean
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export default function ActivePlayersPage() {
  const router = useRouter()
  const { location } = useLocation()
  const { profile } = useProfile()
  const [players, setPlayers] = useState<NearbyPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!location) return
    const load = () => {
      fetch(`/api/players/nearby?lat=${location.lat}&lng=${location.lng}`)
        .then(r => r.json())
        .then(d => setPlayers(d.players ?? []))
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    load()
    const iv = setInterval(load, 12000)
    return () => clearInterval(iv)
  }, [location?.lat, location?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sort by distance from the player
  const sorted = location
    ? [...players].sort((a, b) =>
        milesBetween(location.lat, location.lng, a.lat, a.lng) -
        milesBetween(location.lat, location.lng, b.lat, b.lng))
    : players

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="text-white font-bold text-lg flex items-center gap-2">
          <Radar size={18} className="text-green-400" /> Active Players
        </h1>
        <span className="ml-auto text-green-400 text-sm font-bold">{sorted.length}</span>
      </div>

      {!location ? (
        <p className="text-gray-500 text-sm text-center py-12">📍 Finding your location...</p>
      ) : loading ? (
        <p className="text-gray-500 text-sm text-center py-12">Scanning the area...</p>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <Radar size={40} className="text-gray-700 mb-3" />
          <p className="text-gray-400 font-medium">No active players nearby</p>
          <p className="text-gray-600 text-sm mt-1">
            Only players visible on your map show up here — anyone incognito to you stays hidden.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-900">
          {sorted.map(p => {
            const color = p.party === 'democrat' ? '#2563eb' : p.party === 'republican' ? '#dc2626' : '#6b7280'
            const dist = location ? milesBetween(location.lat, location.lng, p.lat, p.lng) : 0
            return (
              <button key={p.profile_id}
                onClick={() => router.push(`/player/${p.profile_id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-900 transition text-left">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover border-2 flex-shrink-0" style={{ borderColor: color }} />
                ) : (
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-lg border-2 flex-shrink-0"
                    style={{ borderColor: color, background: `${color}22` }}>
                    {p.party === 'democrat' ? '🔵' : p.party === 'republican' ? '🔴' : '⚪'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white font-bold text-sm truncate">{p.username}</div>
                  <div className="text-gray-500 text-xs">
                    {p.party ? (p.party === 'democrat' ? 'Democrat' : 'Republican') : 'Affiliation hidden'}
                    {p.party && profile?.party && p.party !== profile.party && <span className="text-red-400"> · rival</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-gray-300 text-xs font-bold">{dist < 0.1 ? 'here' : `${dist.toFixed(1)} mi`}</div>
                  <div className={`text-[10px] ${p.approx ? 'text-yellow-500/80' : 'text-green-500/80'}`}>
                    {p.approx ? '≈ approx' : '📍 exact'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

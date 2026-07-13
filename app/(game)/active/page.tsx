'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Radar, LayoutGrid, List } from 'lucide-react'
import { useLocation } from '@/hooks/useLocation'
import { useProfile } from '@/hooks/useProfile'

interface NearbyPlayer {
  profile_id: string
  username: string
  party: 'democrat' | 'republican' | null
  gender: 'male' | 'female' | null
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
const partyColor = (p: string | null) => p === 'democrat' ? '#2563eb' : p === 'republican' ? '#dc2626' : '#6b7280'
const partyEmoji = (p: string | null) => p === 'democrat' ? '🔵' : p === 'republican' ? '🔴' : '⚪'

export default function ActivePlayersPage() {
  const router = useRouter()
  const { location } = useLocation()
  const { profile } = useProfile()
  const [players, setPlayers] = useState<NearbyPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [party, setParty] = useState<'all' | 'democrat' | 'republican'>('all')
  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all')

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

  const shown = (location
    ? [...players].sort((a, b) =>
        milesBetween(location.lat, location.lng, a.lat, a.lng) -
        milesBetween(location.lat, location.lng, b.lat, b.lng))
    : players)
    .filter(p => party === 'all' || p.party === party)
    .filter(p => gender === 'all' || p.gender === gender)

  const distOf = (p: NearbyPlayer) => location ? milesBetween(location.lat, location.lng, p.lat, p.lng) : 0
  const Seg = ({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: any) => void }) => (
    <div className="flex rounded-lg overflow-hidden border border-gray-800 text-xs">
      {options.map(([val, label], i) => (
        <button key={val} onClick={() => onChange(val)}
          className={`px-3 py-1.5 font-bold transition ${i > 0 ? 'border-l border-gray-800' : ''}`}
          style={{ background: value === val ? '#7c3aed' : 'transparent', color: value === val ? '#fff' : '#9ca3af' }}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="text-white font-bold text-lg flex items-center gap-2">
          <Radar size={18} className="text-green-400" /> Active Players
          <span className="text-green-400 font-bold">{shown.length}</span>
        </h1>
        {/* Grid / List toggle — kept left of the hamburger menu (top-right) */}
        <button onClick={() => setView(v => v === 'grid' ? 'list' : 'grid')}
          className="ml-auto mr-12 flex items-center gap-1 text-xs font-bold text-purple-300 border border-purple-800 rounded-lg px-2.5 py-1.5 hover:bg-purple-950/40 transition">
          {view === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
          {view === 'grid' ? 'List' : 'Grid'}
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-2.5 flex flex-wrap gap-2 border-b border-gray-900">
        <Seg value={party} onChange={setParty} options={[['all', 'All'], ['democrat', '🔵 Dem'], ['republican', '🔴 Rep']]} />
        <Seg value={gender} onChange={setGender} options={[['all', 'All'], ['male', '♂'], ['female', '♀']]} />
      </div>

      {!location ? (
        <p className="text-gray-500 text-sm text-center py-12">📍 Finding your location...</p>
      ) : loading ? (
        <p className="text-gray-500 text-sm text-center py-12">Scanning the area...</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <Radar size={40} className="text-gray-700 mb-3" />
          <p className="text-gray-400 font-medium">No players match</p>
          <p className="text-gray-600 text-sm mt-1">Try clearing the filters. Anyone incognito to you stays hidden.</p>
        </div>
      ) : view === 'grid' ? (
        // ── Grid (Grindr-style) ──────────────────────────────────────────────
        <div className="grid grid-cols-3 gap-0.5 p-0.5">
          {shown.map(p => {
            const dist = distOf(p)
            return (
              <button key={p.profile_id} onClick={() => router.push(`/player/${p.profile_id}`)}
                className="relative aspect-square overflow-hidden bg-gray-900 group">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="w-full h-full object-cover group-active:scale-105 transition" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl"
                    style={{ background: `${partyColor(p.party)}22` }}>{partyEmoji(p.party)}</div>
                )}
                <div className="absolute top-1 left-1 w-2.5 h-2.5 rounded-full border border-white/70" style={{ background: partyColor(p.party) }} />
                <div className="absolute bottom-0 left-0 right-0 px-2 pt-4 pb-1.5"
                  style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.92), rgba(0,0,0,0.5) 55%, transparent)' }}>
                  <div className="text-white text-sm font-black truncate leading-tight" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>{p.username}</div>
                  <div className="text-gray-200 text-[11px] font-semibold">{dist < 0.1 ? 'here' : `${dist.toFixed(1)} mi`}</div>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        // ── List ─────────────────────────────────────────────────────────────
        <div className="divide-y divide-gray-900">
          {shown.map(p => {
            const dist = distOf(p)
            return (
              <div key={p.profile_id} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-900 transition">
                <button onClick={() => router.push(`/player/${p.profile_id}`)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover border-2 flex-shrink-0" style={{ borderColor: partyColor(p.party) }} />
                  ) : (
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-lg border-2 flex-shrink-0" style={{ borderColor: partyColor(p.party), background: `${partyColor(p.party)}22` }}>{partyEmoji(p.party)}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-bold text-sm truncate">{p.username}</div>
                    <div className="text-gray-500 text-xs">
                      {p.party ? (p.party === 'democrat' ? 'Democrat' : 'Republican') : 'Affiliation hidden'}
                      {p.party && profile?.party && p.party !== profile.party && <span className="text-red-400"> · rival</span>}
                    </div>
                  </div>
                </button>
                <button onClick={() => router.push(`/map?flat=${p.lat}&flng=${p.lng}`)}
                  className="text-right flex-shrink-0 rounded-lg px-2 py-1 hover:bg-gray-800 transition" title="Show on map">
                  <div className="text-gray-300 text-xs font-bold">{dist < 0.1 ? 'here' : `${dist.toFixed(1)} mi`}</div>
                  <div className={`text-[10px] ${p.approx ? 'text-yellow-500/80' : 'text-green-500/80'}`}>{p.approx ? '≈ approx' : '📍 exact'} ›</div>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { ArrowLeft } from 'lucide-react'

interface CapturedCharacter {
  id: string
  enemy_id: string
  enemy_name: string
  enemy_tier: string
  enemy_image: string
  enemy_party: string
  captured_at: string
}

const ALL_ENEMIES = [
  { id: 'oil_baron',      name: 'Oil Baron',       party: 'republican', tier: 'rare',      image: '/enemies/republican/oil_baron.jpg' },
  { id: 'cowboy',         name: 'Lone Star',        party: 'republican', tier: 'common',    image: '/enemies/republican/cowboy.jpg' },
  { id: 'politician',     name: 'The Don',          party: 'republican', tier: 'legendary', image: '/enemies/republican/politician.jpg' },
  { id: 'eagle',          name: 'Freedom Eagle',    party: 'republican', tier: 'common',    image: '/enemies/republican/eagle.jpg' },
  { id: 'hick',           name: 'Good Ole Boy',     party: 'republican', tier: 'common',    image: '/enemies/republican/hick.jpg' },
  { id: 'crazy_liberal',  name: 'Policy Wonk',      party: 'democrat',   tier: 'common',    image: '/enemies/democrat/crazy_liberal.jpg' },
  { id: 'crying_liberal', name: 'Tear Drop',        party: 'democrat',   tier: 'common',    image: '/enemies/democrat/crying_liberal.jpg' },
  { id: 'dem_politician', name: 'Shadow Senator',   party: 'democrat',   tier: 'legendary', image: '/enemies/democrat/politician_dems.jpg' },
  { id: 'purple_hair',    name: 'Purple Fury',      party: 'democrat',   tier: 'rare',      image: '/enemies/democrat/purple_hair.jpg' },
  { id: 'protestor',      name: 'Riot Gear',        party: 'democrat',   tier: 'rare',      image: '/enemies/democrat/protestor.jpg' },
]

export default function CollectionPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const [captured, setCaptured] = useState<CapturedCharacter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/collection')
      .then(r => r.json())
      .then(data => { setCaptured(data.collection || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const capturedIds = new Set(captured.map(c => c.enemy_id))
  const tierColor = (tier: string) =>
    tier === 'legendary' ? '#f59e0b' : tier === 'rare' ? '#8b5cf6' : '#6b7280'

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-3 hover:text-white">
          <ArrowLeft size={16} /><span className="text-sm">Back</span>
        </button>
        <h1 className="text-white font-bold text-2xl">Collection</h1>
        <p className="text-gray-500 text-sm mt-1">
          {captured.length} / {ALL_ENEMIES.length} captured
        </p>
        {/* Progress bar */}
        <div className="h-2 bg-gray-800 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-yellow-500 transition-all"
            style={{ width: `${(captured.length / ALL_ENEMIES.length) * 100}%` }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-400">Loading collection...</p>
        </div>
      ) : (
        <div className="px-4 mt-4 grid grid-cols-2 gap-3">
          {ALL_ENEMIES.map(e => {
            const isCaptured = capturedIds.has(e.id)
            const captureData = captured.find(c => c.enemy_id === e.id)
            const color = tierColor(e.tier)

            return (
              <div
                key={e.id}
                className="rounded-2xl overflow-hidden border relative"
                style={{
                  borderColor: isCaptured ? color : '#1f2937',
                  background: isCaptured ? `${color}11` : '#0f172a',
                }}
              >
                {/* Image */}
                <div className="relative">
                  <img
                    src={e.image}
                    alt={e.name}
                    className="w-full h-32 object-cover"
                    style={{ filter: isCaptured ? 'none' : 'grayscale(1) brightness(0.3)' }}
                  />
                  {!isCaptured && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-4xl">❓</span>
                    </div>
                  )}
                  {isCaptured && (
                    <div className="absolute top-2 right-2">
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `${color}33`, color }}
                      >
                        {e.tier === 'legendary' ? '⭐' : e.tier === 'rare' ? '💜' : '•'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-2">
                  <div className="text-white text-xs font-bold truncate">
                    {isCaptured ? e.name : '???'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: isCaptured ? color : '#374151' }}>
                    {isCaptured ? e.tier : 'Not captured'}
                  </div>
                  {isCaptured && captureData && (
                    <div className="text-gray-600 text-xs mt-0.5">
                      {new Date(captureData.captured_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
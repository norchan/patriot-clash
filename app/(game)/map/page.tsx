'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLocation } from '@/hooks/useLocation'
import { useProfile } from '@/hooks/useProfile'
import { useSteps } from '@/hooks/useSteps'
import { getRandomEnemy } from '@/config/enemies'
import type { Enemy } from '@/config/enemies'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

interface SpawnedEnemy {
  id: string
  enemy: Enemy
  lat: number
  lng: number
}

interface Gym {
  id: string
  city_name: string
  state: string
  holder_party: string | null
  holder_username: string | null
  defense_points: number
  distance_miles: string
  latitude: number
  longitude: number
}

export default function MapPage() {
  const router = useRouter()
  const { location, error: locationError, loading: locationLoading } = useLocation()
  const { profile, loading: profileLoading } = useProfile()
  const { steps, fpEarned } = useSteps()
  const [gyms, setGyms] = useState<Gym[]>([])
  const [spawnedEnemies, setSpawnedEnemies] = useState<SpawnedEnemy[]>([])
  const [fpToast, setFpToast] = useState('')
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const playerMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const mapInitialized = useRef(false)

  // Initialize map when location is available
  useEffect(() => {
    if (!location || !mapContainer.current || mapInitialized.current) return
    mapInitialized.current = true

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [location.lng, location.lat],
      zoom: 16,
      pitch: 30,
    })

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    return () => {
      map.current?.remove()
      mapInitialized.current = false
    }
  }, [location])

  // Update player marker
  useEffect(() => {
    if (!map.current || !location) return

    if (playerMarkerRef.current) {
      playerMarkerRef.current.setLngLat([location.lng, location.lat])
    } else {
      const el = document.createElement('div')
      el.className = 'player-marker'
      el.style.cssText = `
        width: 20px;
        height: 20px;
        background: ${profile?.party === 'democrat' ? '#2563eb' : '#dc2626'};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 0 0 3px ${profile?.party === 'democrat' ? '#2563eb' : '#dc2626'}, 0 0 15px ${profile?.party === 'democrat' ? '#2563eb88' : '#dc262688'};
        cursor: pointer;
      `
      playerMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([location.lng, location.lat])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(`📍 ${profile?.username || 'You'}`))
        .addTo(map.current!)
    }
  }, [location, profile])

  // Fetch nearby gyms
  useEffect(() => {
    if (!location) return
    fetch(`/api/gyms?lat=${location.lat}&lng=${location.lng}`)
      .then(r => r.json())
      .then(data => setGyms(data.gyms || []))
      .catch(console.error)
  }, [location])

  // Add gym markers to map
  useEffect(() => {
    if (!map.current || gyms.length === 0) return

    // Wait for map to load
    const addGyms = () => {
      gyms.forEach(gym => {
        const el = document.createElement('div')
        const partyColor = gym.holder_party === 'democrat' ? '#2563eb'
          : gym.holder_party === 'republican' ? '#dc2626' : '#6b7280'
        const flagEmoji = gym.holder_party === 'democrat' ? '🔵'
          : gym.holder_party === 'republican' ? '🔴' : '⚪'

        el.innerHTML = `
          <div style="
            background: rgba(0,0,0,0.85);
            border: 2px solid ${partyColor};
            border-radius: 10px;
            padding: 4px 8px;
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          ">
            <span style="font-size: 14px;">🏛️</span>
            <span style="color: white; font-size: 11px; font-weight: 600;">${gym.city_name}</span>
            <span style="font-size: 10px;">${flagEmoji}</span>
          </div>
        `
        el.style.cursor = 'pointer'
        el.addEventListener('click', () => router.push(`/townhall/${gym.id}`))

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([gym.longitude, gym.latitude])
          .addTo(map.current!)

        markersRef.current.push(marker)
      })
    }

    if (map.current.isStyleLoaded()) {
      addGyms()
    } else {
      map.current.on('load', addGyms)
    }
  }, [gyms, router])

  // Spawn enemies near player
  useEffect(() => {
    if (!location || !profile || !map.current) return

    const enemies: SpawnedEnemy[] = Array.from({ length: 5 }, (_, i) => {
      const angle = (i / 5) * Math.PI * 2
      const distance = 0.002 + Math.random() * 0.003
      return {
        id: `enemy_${i}_${Date.now()}`,
        enemy: getRandomEnemy(profile.party),
        lat: location.lat + Math.sin(angle) * distance,
        lng: location.lng + Math.cos(angle) * distance,
      }
    })
    setSpawnedEnemies(enemies)
  }, [location?.lat, location?.lng, profile])

  // Add enemy markers to map
  useEffect(() => {
    if (!map.current || spawnedEnemies.length === 0) return

    const addEnemies = () => {
      spawnedEnemies.forEach(spawn => {
        const el = document.createElement('div')
        el.style.cssText = `
          width: 52px;
          height: 52px;
          border-radius: ${spawn.enemy.tier === 'legendary' ? '12px' : '50%'};
          overflow: hidden;
          border: 3px solid ${spawn.enemy.tier === 'legendary' ? '#f59e0b' : spawn.enemy.tier === 'rare' ? '#8b5cf6' : '#6b7280'};
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          cursor: pointer;
          animation: bounce 2s infinite;
        `
        el.innerHTML = `<img src="${spawn.enemy.image}" style="width:100%;height:100%;object-fit:cover;" />`
        el.addEventListener('click', () => router.push(`/battle?enemy=${spawn.enemy.id}`))

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([spawn.lng, spawn.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 30, closeButton: false })
              .setHTML(`<div style="font-weight:600;font-size:12px;">${spawn.enemy.name}</div><div style="font-size:11px;color:#888;">${spawn.enemy.tier} • Tap to battle</div>`)
          )
          .addTo(map.current!)

        markersRef.current.push(marker)
      })
    }

    if (map.current.isStyleLoaded()) {
      addEnemies()
    } else {
      map.current.on('load', addEnemies)
    }
  }, [spawnedEnemies, router])

  // FP toast
  useEffect(() => {
    if (fpEarned > 0) {
      setFpToast(`⚡ +${fpEarned} FP from walking!`)
      setTimeout(() => setFpToast(''), 3000)
    }
  }, [fpEarned])

  const partyColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'

  if (locationLoading || profileLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🏛️</div>
          <p className="text-gray-400">Loading your map...</p>
          <p className="text-gray-600 text-xs mt-2">Getting your location...</p>
        </div>
      </div>
    )
  }

  if (locationError) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-4xl mb-4">📍</div>
          <h2 className="text-white font-bold mb-2">Location Required</h2>
          <p className="text-gray-400 text-sm">{locationError}</p>
          <p className="text-gray-500 text-xs mt-2">Enable location access in your browser settings</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen overflow-hidden">
      {/* Mapbox container */}
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* HUD Top Left */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <div className="bg-black/75 backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ background: partyColor }} />
          <span className="text-white text-xs font-semibold">
            {profile?.party === 'democrat' ? 'Democrats' : 'Republicans'}
          </span>
        </div>
        <div className="bg-black/75 backdrop-blur rounded-xl px-3 py-2">
          <span className="text-white text-xs">👟 {steps.toLocaleString()} steps</span>
        </div>
      </div>

      {/* HUD Top Right - FP */}
      <div className="absolute top-4 right-14 z-20">
        <div className="bg-black/75 backdrop-blur rounded-xl px-3 py-2">
          <span className="text-yellow-400 text-xs font-bold">⚡ {profile?.fp_balance?.toLocaleString() || 0} FP</span>
        </div>
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-6 left-0 right-0 z-20 flex justify-center px-4">
        <div className="bg-black/75 backdrop-blur rounded-full px-5 py-2.5 flex items-center gap-3">
          <span className="text-white text-xs">{spawnedEnemies.length} enemies nearby</span>
          <div className="w-px h-3 bg-gray-600" />
          <span className="text-white text-xs">{gyms.length} town halls in range</span>
        </div>
      </div>

      {/* FP Toast */}
      {fpToast && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-30">
          <div className="bg-yellow-500 text-black font-bold px-4 py-2 rounded-full text-sm shadow-lg">
            {fpToast}
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .mapboxgl-popup-content {
          background: rgba(17, 24, 39, 0.95) !important;
          color: white !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 8px !important;
          padding: 8px 12px !important;
        }
        .mapboxgl-popup-tip {
          border-top-color: rgba(17, 24, 39, 0.95) !important;
        }
      `}</style>
    </div>
  )
}
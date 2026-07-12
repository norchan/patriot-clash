'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { republicanEnemies, democratEnemies } from '@/config/enemies'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

// GUEST PREVIEW: the live game map for the signed-out. Anonymized dots
// instead of players, real halls and sprites — and touching ANYTHING that
// isn't map navigation routes to sign-up.

const FALLBACK = { lat: 44.3233, lng: -93.9579, zoom: 9 } // St. Peter, MN

function makeCircleCoords(lng: number, lat: number, radiusMiles: number, steps = 48): [number, number][] {
  const rLat = radiusMiles / 69
  const rLng = radiusMiles / (69 * Math.cos(lat * Math.PI / 180))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * Math.PI * 2
    return [lng + Math.cos(a) * rLng, lat + Math.sin(a) * rLat] as [number, number]
  })
}

function seededRand(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return Math.abs(h) / 2147483647
}

export default function WelcomePage() {
  const router = useRouter()
  const { isSignedIn, isLoaded } = useUser()
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const started = useRef(false)
  const [ctaPulse, setCtaPulse] = useState(false)

  // Signed-in players don't belong here
  useEffect(() => {
    if (isLoaded && isSignedIn) router.replace('/map')
  }, [isLoaded, isSignedIn, router])

  const toSignUp = () => {
    setCtaPulse(true)
    setTimeout(() => router.push('/sign-up'), 150)
  }

  useEffect(() => {
    if (started.current || !mapContainer.current) return
    started.current = true

    const boot = (center: { lat: number; lng: number; zoom: number }) => {
      const m = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [center.lng, center.lat],
        zoom: center.zoom,
        pitch: 30,
      })
      map.current = m
      m.addControl(new mapboxgl.NavigationControl(), 'top-right')

      const loadWorld = async () => {
        const c = m.getCenter()
        try {
          const res = await fetch(`/api/public/world?lat=${c.lat}&lng=${c.lng}`)
          const d = await res.json()
          drawWorld(m, d.halls ?? [], d.players ?? [])
        } catch {}
      }
      if (m.isStyleLoaded()) loadWorld()
      else m.once('idle', loadWorld)
      m.on('moveend', () => {
        // refetch when the guest pans far
        loadWorld()
      })
    }

    navigator.geolocation?.getCurrentPosition(
      pos => boot({ lat: pos.coords.latitude, lng: pos.coords.longitude, zoom: 11 }),
      () => boot(FALLBACK),
      { timeout: 4000 }
    ) ?? boot(FALLBACK)

    return () => { map.current?.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function drawWorld(m: mapboxgl.Map, halls: any[], players: any[]) {
    // zone circles
    const circles = {
      type: 'FeatureCollection' as const,
      features: halls.map(h => ({
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [makeCircleCoords(h.longitude, h.latitude, h.radius_miles)] },
        properties: { party: h.holder_party ?? 'none' },
      })),
    }
    try {
      if (m.getSource('zones')) (m.getSource('zones') as mapboxgl.GeoJSONSource).setData(circles)
      else {
        m.addSource('zones', { type: 'geojson', data: circles })
        m.addLayer({
          id: 'zones-fill', type: 'fill', source: 'zones',
          paint: { 'fill-color': ['match', ['get', 'party'], 'democrat', '#3b82f6', 'republican', '#ef4444', '#e5e7eb'], 'fill-opacity': 0.16 },
        })
        m.addLayer({
          id: 'zones-line', type: 'line', source: 'zones',
          paint: { 'line-color': ['match', ['get', 'party'], 'democrat', '#60a5fa', 'republican', '#f87171', '#d1d5db'], 'line-width': 2, 'line-opacity': 0.8 },
        })
      }
    } catch {}

    // rebuild markers
    markersRef.current.forEach(mk => mk.remove())
    markersRef.current = []

    // halls (buildings + names — halls are public knowledge)
    halls.slice(0, 30).forEach(h => {
      const color = h.holder_party === 'democrat' ? '#2563eb' : h.holder_party === 'republican' ? '#dc2626' : '#6b7280'
      const el = document.createElement('div')
      el.style.cursor = 'pointer'
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;">
          <img src="/halls/hall_intact.webp" style="width:46px;height:auto;pointer-events:none;filter:drop-shadow(0 0 6px ${color}) drop-shadow(0 2px 4px rgba(0,0,0,0.6));" />
          <div style="background:rgba(0,0,0,0.85);border:1.5px solid ${color};border-radius:7px;padding:1px 6px;color:white;font-size:10px;font-weight:700;white-space:nowrap;">${h.city_name}</div>
        </div>`
      el.addEventListener('click', toSignUp)
      markersRef.current.push(new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([h.longitude, h.latitude]).addTo(m))
    })

    // anonymized player dots
    players.slice(0, 80).forEach((p, i) => {
      const color = p.party === 'democrat' ? '#2563eb' : '#dc2626'
      const el = document.createElement('div')
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 6px ${color}aa;cursor:pointer;`
      el.addEventListener('click', toSignUp)
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m))
    })

    // a few wandering sprites near the center, seeded per view
    const c = m.getCenter()
    const all = [...republicanEnemies, ...democratEnemies]
    for (let i = 0; i < 6; i++) {
      const e = all[Math.floor(seededRand(`e${i}|${c.lat.toFixed(1)}`) * all.length)]
      const angle = seededRand(`a${i}|${c.lat.toFixed(1)}`) * Math.PI * 2
      const dist = 1 + seededRand(`d${i}|${c.lng.toFixed(1)}`) * 4
      const lat = c.lat + (dist / 69) * Math.sin(angle)
      const lng = c.lng + (dist / (69 * Math.cos(c.lat * Math.PI / 180))) * Math.cos(angle)
      const el = document.createElement('div')
      el.style.cursor = 'pointer'
      el.innerHTML = `
        <div style="width:44px;height:44px;border-radius:11px;transform:rotate(45deg);overflow:hidden;border:2.5px solid #8b5cf6;background:radial-gradient(circle at 50% 32%, #8b5cf630 0%, #101828 75%);box-shadow:0 0 10px #8b5cf677;">
          <img src="${e.image}" style="width:100%;height:100%;object-fit:contain;transform:rotate(-45deg) scale(1.4);padding:2px;" />
        </div>`
      el.addEventListener('click', toSignUp)
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m))
    }
  }

  return (
    <div className="relative h-screen overflow-hidden max-w-md mx-auto bg-gray-950">
      <div ref={mapContainer} className="absolute inset-0" />

      {/* top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-4 flex items-center justify-between pointer-events-none">
        <div className="bg-black/80 backdrop-blur rounded-xl px-3 py-2 pointer-events-auto">
          <span className="text-white font-black text-sm">🏛️ PoliticsGo</span>
        </div>
        <button onClick={() => router.push('/sign-in')}
          className="bg-black/80 backdrop-blur rounded-xl px-4 py-2 text-white text-sm font-bold pointer-events-auto hover:bg-black/90 transition mr-11">
          Sign In
        </button>
      </div>

      {/* bottom CTA */}
      <div className="absolute bottom-6 left-4 right-4 z-20">
        <div className={`bg-gray-900/95 backdrop-blur rounded-2xl border border-gray-700 p-4 shadow-2xl transition-transform ${ctaPulse ? 'scale-95' : ''}`}>
          <p className="text-white font-bold text-sm text-center">This battle is live. Pick a side.</p>
          <p className="text-gray-400 text-xs text-center mt-1">
            Capture town halls · battle rivals · walk to earn Fighting Points
          </p>
          <button onClick={toSignUp}
            className="w-full mt-3 py-3.5 rounded-xl font-black text-white text-base transition active:scale-95"
            style={{ background: 'linear-gradient(90deg, #2563eb, #7c3aed, #dc2626)' }}>
            ⚔️ JOIN THE FIGHT — FREE
          </button>
          <a href="/explore" className="block text-center text-gray-400 hover:text-white text-xs mt-2.5 underline">
            Explore town halls & town squares →
          </a>
        </div>
      </div>
    </div>
  )
}

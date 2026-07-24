'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Gamepad2, User, Landmark, MessagesSquare, Newspaper } from 'lucide-react'
import mapboxgl from 'mapbox-gl'
import { Delaunay } from 'd3-delaunay'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

// THE PUBLIC BATTLE MAP (shared by / and /battlemap).
// - every town hall as a party-colored glow dot
// - INGRESS-STYLE territory web: same-party halls linked by lines; triangles
//   whose three corners share a party fill with translucent territory color
//   (battlemap only — the in-game player map is untouched)
// - default view: Cahokia, IL with St. Louis in frame (the ancient capital)
// - "find your town hall" popup: share location OR search by name

export interface HallDot { id?: string; lat: number; lng: number; party: string | null; city: string; state: string }

const CAHOKIA: [number, number] = [-90.06, 38.62] // Cahokia Mounds; STL across the river
const MAX_EDGE_DEG = 2.3 // skip absurd cross-country hull edges

const dist = (a: HallDot, lat: number, lng: number) =>
  Math.hypot(a.lat - lat, (a.lng - lng) * Math.cos((lat * Math.PI) / 180))

export default function BattleMap({ halls, height = '60vh', signedIn = false, homeGymId = null, homeCenter = null }: {
  halls: HallDot[]
  height?: string
  signedIn?: boolean
  homeGymId?: string | null
  homeCenter?: { lat: number; lng: number } | null // signed-in: open over the assigned hall
}) {
  const router = useRouter()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [finder, setFinder] = useState(false)
  // finder flavors: 'hall' = the Town Hall dock button (existing behavior),
  // 'join' = the Join the Fight button — picks a spot, then INTO the game
  const [joinMode, setJoinMode] = useState(false)
  const [query, setQuery] = useState('')
  const [locating, setLocating] = useState(false)
  const [locErr, setLocErr] = useState('')

  // Join the Fight: drop into the game at this spot — the real map for
  // players, the guest world (Cahokia-style but centered here) for visitors
  function enterGame(lat: number, lng: number) {
    setFinder(false)
    router.push(`${signedIn ? '/map' : '/play'}?flat=${lat.toFixed(5)}&flng=${lng.toFixed(5)}`)
  }

  useEffect(() => {
    if (!el.current || map.current) return
    // signed-in players open hovering over their assigned town hall;
    // everyone else lands on Cahokia with St. Louis in frame
    const m = new mapboxgl.Map({
      container: el.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: homeCenter ? [homeCenter.lng, homeCenter.lat] : CAHOKIA,
      zoom: homeCenter ? 9.3 : 7.6, // opens a notch further out (Michael)
      minZoom: 2.8,
      maxZoom: 12,
    })
    map.current = m
    // capture tooling (OG card re-shoots): lets a headless script steer the
    // view (projection/bounds) — harmless in normal use
    ;(window as any).__bmap = m
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    m.on('load', () => {
      // ── Ingress web: Delaunay over all halls ─────────────────────────────
      const pts = halls.map(h => [h.lng, h.lat] as [number, number])
      const del = Delaunay.from(pts)
      const lineFeats: any[] = []
      const fieldFeats: any[] = []
      const seen = new Set<string>()
      const { triangles } = del
      for (let t = 0; t < triangles.length; t += 3) {
        const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]]
        const [ha, hb, hc] = [halls[a], halls[b], halls[c]]
        // links: same-party edges, deduped, sane length
        for (const [i, j] of [[a, b], [b, c], [c, a]]) {
          const key = i < j ? `${i}-${j}` : `${j}-${i}`
          if (seen.has(key)) continue
          seen.add(key)
          const hi = halls[i], hj = halls[j]
          if (!hi.party || hi.party !== hj.party) continue
          if (Math.hypot(hi.lat - hj.lat, hi.lng - hj.lng) > MAX_EDGE_DEG) continue
          lineFeats.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[hi.lng, hi.lat], [hj.lng, hj.lat]] },
            properties: { party: hi.party },
          })
        }
        // fields: all three corners one party
        if (ha.party && ha.party === hb.party && hb.party === hc.party) {
          const maxSide = Math.max(
            Math.hypot(ha.lat - hb.lat, ha.lng - hb.lng),
            Math.hypot(hb.lat - hc.lat, hb.lng - hc.lng),
            Math.hypot(hc.lat - ha.lat, hc.lng - ha.lng))
          if (maxSide <= MAX_EDGE_DEG) {
            fieldFeats.push({
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [[[ha.lng, ha.lat], [hb.lng, hb.lat], [hc.lng, hc.lat], [ha.lng, ha.lat]]] },
              properties: { party: ha.party },
            })
          }
        }
      }
      m.addSource('fields', { type: 'geojson', data: { type: 'FeatureCollection', features: fieldFeats } })
      m.addLayer({
        id: 'fields', type: 'fill', source: 'fields',
        paint: {
          'fill-color': ['match', ['get', 'party'], 'democrat', '#3b82f6', '#ef4444'],
          'fill-opacity': 0.10,
        },
      })
      m.addSource('links', { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeats } })
      m.addLayer({
        id: 'links', type: 'line', source: 'links',
        paint: {
          'line-color': ['match', ['get', 'party'], 'democrat', '#60a5fa', '#f87171'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 8, 1.1, 11, 1.8],
          'line-opacity': 0.45,
        },
      })

      // ── hall dots ────────────────────────────────────────────────────────
      m.addSource('halls', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: halls.map((h, idx) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] },
            properties: { party: h.party ?? 'open', name: `${h.city}, ${h.state}`, idx },
          })),
        },
      })
      m.addLayer({
        id: 'halls-glow', type: 'circle', source: 'halls',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 7, 9, 10, 14],
          'circle-blur': 0.6, 'circle-opacity': 0.55,
          'circle-color': ['match', ['get', 'party'], 'democrat', '#3b82f6', 'republican', '#ef4444', '#6b7280'],
        },
      })
      m.addLayer({
        id: 'halls-core', type: 'circle', source: 'halls',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 7, 3.5, 10, 6],
          'circle-color': ['match', ['get', 'party'], 'democrat', '#93c5fd', 'republican', '#fca5a5', '#9ca3af'],
        },
      })
      // dark popup theme — mapbox's default popup is white, and the page's
      // white text made it unreadable (white-on-white, Michael 2026-07-21)
      if (!document.getElementById('pg-hallpop-styles')) {
        const s = document.createElement('style')
        s.id = 'pg-hallpop-styles'
        s.textContent = `
          .pg-hallpop .mapboxgl-popup-content { background:#111827; color:#f9fafb; border:1px solid rgba(255,255,255,0.18); border-radius:12px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,0.6); }
          .pg-hallpop .mapboxgl-popup-tip { border-top-color:#111827 !important; border-bottom-color:#111827 !important; }
          .pg-hallpop .mapboxgl-popup-close-button { color:#9ca3af; font-size:16px; padding:2px 6px; }
        `
        document.head.appendChild(s)
      }
      const hoverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'pg-hallpop' })
      m.on('mousemove', 'halls-glow', e => {
        const f = e.features?.[0]
        if (!f) return
        m.getCanvas().style.cursor = 'pointer'
        hoverPopup.setLngLat((f.geometry as any).coordinates)
          .setHTML(`<div style="font-weight:700;font-size:12px">${(f.properties as any).name}</div>`)
          .addTo(m)
      })
      m.on('mouseleave', 'halls-glow', () => { m.getCanvas().style.cursor = ''; hoverPopup.remove() })

      // tap a dot → popup with the hall's name; tap the name → the town hall
      // (signed-in) or fly in close (guests)
      const clickPopup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 12, className: 'pg-hallpop' })
      m.on('click', 'halls-glow', e => {
        const f = e.features?.[0]
        if (!f) return
        hoverPopup.remove()
        const h = halls[(f.properties as any).idx]
        const node = document.createElement('div')
        node.style.cursor = 'pointer'
        node.innerHTML = `
          <div style="font-weight:800;font-size:13px;">🏛️ ${(f.properties as any).name}</div>
          <div style="font-size:10px;color:#a78bfa;margin-top:3px;font-weight:700;">${signedIn ? 'Open this town hall →' : 'Zoom in →'}</div>`
        node.onclick = () => { clickPopup.remove(); if (h) goToHall(h) }
        clickPopup.setLngLat((f.geometry as any).coordinates).setDOMContent(node).addTo(m)
      })
    })
    // container size can change as the responsive grid reflows — keep the
    // canvas in sync so the map never paints at a stale/zero size
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Signed-in: go to the hall's page. Guests: fly the map to it.
  function goToHall(h: HallDot) {
    setFinder(false)
    if (signedIn && h.id) { router.push(`/townhall/${h.id}`); return }
    map.current?.flyTo({ center: [h.lng, h.lat], zoom: 10.5, duration: 2200 })
  }

  function nearestHall(lat: number, lng: number): HallDot | undefined {
    return [...halls].sort((a, b) => dist(a, lat, lng) - dist(b, lat, lng))[0]
  }

  function shareLocation() {
    setLocErr(''); setLocating(true)
    navigator.geolocation?.getCurrentPosition(
      pos => {
        setLocating(false)
        if (joinMode) { enterGame(pos.coords.latitude, pos.coords.longitude); return }
        const h = nearestHall(pos.coords.latitude, pos.coords.longitude)
        if (h) goToHall(h)
      },
      () => { setLocating(false); setLocErr('Location was blocked — try the search instead.') },
      { timeout: 8000 },
    )
  }

  // The Town Hall button: signed-in players jump to their hall; guests get
  // the share-location-or-search popup
  function townHall() {
    if (signedIn) {
      if (homeGymId) { router.push(`/townhall/${homeGymId}`); return }
      setLocErr(''); setLocating(true)
      navigator.geolocation?.getCurrentPosition(
        pos => {
          setLocating(false)
          const h = nearestHall(pos.coords.latitude, pos.coords.longitude)
          if (h?.id) router.push(`/townhall/${h.id}`)
          else setFinder(true)
        },
        () => { setLocating(false); setFinder(true) },
        { timeout: 8000 },
      )
      return
    }
    setFinder(true)
  }

  const results = query.trim().length >= 2
    ? halls.filter(h => `${h.city}, ${h.state}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : []

  return (
    <div>
    <div className="relative w-full overflow-hidden rounded-2xl border border-gray-800"
      style={{ height }}>
      {/* w-full h-full is load-bearing: mapbox-gl.css forces .mapboxgl-map to
          position:relative (beating our `absolute`), so inset-0 alone
          collapses to 0 height */}
      <div ref={el} className="absolute inset-0 w-full h-full" />

      {/* expand into the game — just above mapbox's ⓘ button */}
      <button onClick={() => router.push(signedIn ? '/map' : '/play')}
        title={signedIn ? 'Open your game map' : 'Play as a guest'}
        aria-label="Expand into the game"
        className="absolute bottom-12 right-2 z-10 w-11 h-11 rounded-full text-lg font-black text-white shadow-xl transition active:scale-95 flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: '1px solid rgba(216,180,254,0.5)' }}>
        ⛶
      </button>


      {/* finder popup — doubles as the Join the Fight location chooser */}
      {finder && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4"
          style={{ background: 'rgba(3,7,18,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => { setFinder(false); setJoinMode(false) }}>
          <div className="w-full max-w-sm rounded-3xl p-5 shadow-2xl"
            style={{ background: 'linear-gradient(160deg, #17102b, #0b0716)', border: '1px solid rgba(139,92,246,0.45)' }}
            onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-3xl">{joinMode ? '⚔️' : '🏛️'}</div>
              <h3 className="text-white font-black text-lg mt-1">{joinMode ? 'Join the Fight' : 'Find your town hall'}</h3>
              <p className="text-gray-400 text-xs mt-1">
                {joinMode ? 'Pick where you fight — your location or any town in America.' : 'Every hall is real. One of them is yours.'}
              </p>
            </div>
            <button onClick={shareLocation} disabled={locating}
              className="w-full mt-4 py-3 rounded-xl font-black text-white text-sm transition active:scale-95 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              {locating ? 'Locating…' : '📍 Share my location'}
            </button>
            {locErr && <p className="text-red-400 text-xs text-center mt-2">{locErr}</p>}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-white/10" /><span className="text-gray-500 text-[11px] font-bold">OR</span><div className="flex-1 h-px bg-white/10" />
            </div>
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search a city… (e.g. St. Peter)"
              className="w-full px-4 py-3 rounded-xl bg-black/40 border border-purple-900 text-white text-sm placeholder-gray-600 outline-none focus:border-purple-500"
            />
            <div className="mt-2 max-h-44 overflow-y-auto space-y-1">
              {results.map(h => (
                <button key={`${h.city}-${h.state}-${h.lat}`}
                  onClick={() => joinMode ? enterGame(h.lat, h.lng) : goToHall(h)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-gray-200 hover:bg-white/5">
                  <span className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: h.party === 'democrat' ? '#3b82f6' : h.party === 'republican' ? '#ef4444' : '#6b7280' }} />
                  {h.city}, {h.state}
                </button>
              ))}
              {query.trim().length >= 2 && results.length === 0 && (
                <p className="text-gray-600 text-xs text-center py-2">No hall matches “{query.trim()}”</p>
              )}
            </div>
            <button onClick={() => { setFinder(false); setJoinMode(false) }} className="w-full mt-3 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-white bg-white/5">
              Close
            </button>
          </div>
        </div>
      )}
    </div>

    {/* JOIN THE FIGHT — players go straight to their map; guests pick a spot
        (share location / search a town) and drop into the guest world */}
    <button onClick={() => {
        if (signedIn) { router.push('/map'); return }
        setJoinMode(true); setLocErr(''); setQuery(''); setFinder(true)
      }}
      className="mt-4 w-full py-4 rounded-2xl font-black text-lg text-white transition active:scale-[0.98]"
      style={{ background: 'linear-gradient(135deg, #dc2626, #7c3aed)', boxShadow: '0 8px 28px rgba(124,58,237,0.35)' }}>
      {signedIn ? '⚔️ FIGHT MAP ⚔️' : '⚔️ JOIN THE FIGHT ⚔️'}
    </button>

    {/* under-map dock: white icons with names underneath (Michael) */}
    <div className="mt-4 flex items-start justify-center gap-7">
      {([
        { label: 'Boards', icon: Newspaper, go: () => router.push('/boards') },
        { label: 'Arcade', icon: Gamepad2, go: () => router.push(signedIn ? '/arcade' : '/play/arcade') },
        { label: 'Profile', icon: User, go: () => router.push(signedIn ? '/profile' : '/sign-up') },
        { label: 'Town Hall', icon: Landmark, go: townHall },
        { label: 'Messages', icon: MessagesSquare, go: () => router.push(signedIn ? '/messages' : '/sign-up') },
      ] as const).map(({ label, icon: Icon, go }) => (
        <button key={label} onClick={go} disabled={label === 'Town Hall' && locating}
          title={label} aria-label={label}
          className="flex flex-col items-center text-white transition active:scale-90 hover:opacity-80 disabled:opacity-50"
          style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }}>
          <Icon size={38} strokeWidth={2.2} />
          <span className="text-[11px] font-bold mt-1 whitespace-nowrap">{label}</span>
        </button>
      ))}
    </div>
    </div>
  )
}

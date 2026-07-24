'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLocation } from '@/hooks/useLocation'
import { useProfile } from '@/hooks/useProfile'
import { useSteps } from '@/hooks/useSteps'
import { getEnemyById } from '@/config/enemies'
import type { Enemy } from '@/config/enemies'
import { Home } from 'lucide-react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import AlbumViewer from '@/components/AlbumViewer'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

const DEFAULT_RADIUS_MILES = 10 // fallback when a gym has no radius_miles set

// Escape user-controlled strings before injecting into marker innerHTML —
// a username like <img onerror=...> would otherwise execute in every
// nearby player's browser
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

// Haversine distance in miles
function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Mirror of the server's location fuzz (app/api/players/location): same
// hash, same offset — so your own dot can show exactly what others see
function fuzzOffset(id: string, lat: number, lng: number): { lat: number; lng: number } {
  let h = 0
  for (const ch of id) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0
  const angle = (Math.abs(h) / 2147483647) * Math.PI * 2
  const distMiles = 0.8 + (Math.abs(Math.imul(h, 2654435761)) / 2147483647) * 0.4
  return {
    lat: lat + (distMiles / 69) * Math.sin(angle),
    lng: lng + (distMiles / (69 * Math.cos(lat * Math.PI / 180))) * Math.cos(angle),
  }
}

// Returns GeoJSON polygon coordinates approximating a geographic circle
function makeCircleCoords(centerLng: number, centerLat: number, radiusMiles: number, steps = 64): [number, number][] {
  const radiusLat = radiusMiles / 69.0
  const radiusLng = radiusMiles / (69.0 * Math.cos(centerLat * Math.PI / 180))
  const coords: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    coords.push([centerLng + Math.cos(angle) * radiusLng, centerLat + Math.sin(angle) * radiusLat])
  }
  return coords
}

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
  radius_miles: number
}

interface NearbyPlayer {
  profile_id: string
  username: string
  party: 'democrat' | 'republican' | null  // null = hidden affiliation
  lat: number
  lng: number
  allow_messages: boolean
  avatar_url: string | null
  approx?: boolean // marker is offset ~1 mi from their true spot
}

interface IncomingChallenge {
  id: string
  challenger_id: string
  challenger_username: string
  challenger_party: 'democrat' | 'republican'
  fp_stake: number
  expires_at: string
}


export default function MapPage() {
  const router = useRouter()
  const { location, error: locationError, loading: locationLoading } = useLocation()
  const { profile, loading: profileLoading, refetch } = useProfile()
  const { steps, fpEarned } = useSteps()

  // Map state
  const [gyms, setGyms] = useState<Gym[]>([])
  // staged load: player → halls/buildings → sprites → players; set once hall
  // data (cached or fresh) is available
  const [gymsLoaded, setGymsLoaded] = useState(false)
  const didFitRef = useRef(false)
  const playersStartedRef = useRef(false)
  const [spawnedEnemies, setSpawnedEnemies] = useState<SpawnedEnemy[]>([])
  const [spawnTick, setSpawnTick] = useState(0)

  // Re-sync shared spawns every 2 min: fresh generations + other players'
  // catches show up without moving
  useEffect(() => {
    const iv = setInterval(() => setSpawnTick(t => t + 1), 2 * 60_000)
    return () => clearInterval(iv)
  }, [])

  // Every player carries an ASSIGNED TOWN HALL — first location fix assigns
  // the nearest one (cliques/settings can change it later)
  const homeAssigned = useRef(false)
  useEffect(() => {
    if (homeAssigned.current || !profile || (profile as any).home_gym_id || !location) return
    homeAssigned.current = true
    fetch('/api/profile/home-gym', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: location.lat, lng: location.lng }),
    }).catch(() => {})
  }, [profile, location])

  // home hall name for the self-sheet header (tap → the hall page)
  const [homeHall, setHomeHall] = useState<{ id: string; city_name: string; state: string } | null>(null)
  useEffect(() => {
    if (!profile) return
    fetch('/api/profile/home-gym')
      .then(r => r.json())
      .then(d => setHomeHall(d.gym ?? null))
      .catch(() => {})
  }, [profile?.id, (profile as any)?.home_gym_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [nearbyPlayers, setNearbyPlayers] = useState<NearbyPlayer[]>([])
  // "Show on map" dropdown: me = broadcast + own marker, dems/reps = which
  // nearby players get markers. Persisted so the choice survives reloads.
  const [showMapMenu, setShowMapMenu] = useState(false)
  const [mapPrefs, setMapPrefs] = useState({ me: true, dems: true, reps: true, sprites: true })
  // The map's zoom handler closes over applyZoomVisibility once at init —
  // it must read prefs through a ref or it would see the initial state forever
  const mapPrefsRef = useRef(mapPrefs)
  useEffect(() => { mapPrefsRef.current = mapPrefs }, [mapPrefs])
  const [fpToast, setFpToast] = useState('')

  // PvP / player interaction state
  const [selectedPlayer, setSelectedPlayer] = useState<NearbyPlayer | null>(null)
  const [selfSheet, setSelfSheet] = useState(false)
  const [sentChallenge, setSentChallenge] = useState<{ id: string; opponentName: string } | null>(null)
  const [challengeLoading, setChallengeLoading] = useState(false)
  const [pvpToast, setPvpToast] = useState('')

  // Chat state
  const [incomingMsg, setIncomingMsg] = useState<{ sender_id: string; sender_username: string; sender_avatar: string | null; preview: string } | null>(null)
  const lastInboxRef = useRef(new Date(Date.now() - 60 * 1000).toISOString())
  const [album, setAlbum] = useState<{ title: string; photos: { id: string; url: string }[] } | null>(null)
  const [activeChatUserId, setActiveChatUserId] = useState<string | null>(null)
  const [activeChatUsername, setActiveChatUsername] = useState('')
  const [chatMessages, setChatMessages] = useState<{ id: string; sender_id: string; content: string | null; image_url?: string | null; created_at: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const chatBoxRef = useRef<HTMLDivElement>(null)

  // Map refs
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const gymMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  // Arcade markers sit just west of each hall; every one opens /arcade
  const arcadeMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  // Arena — mirrored east of the LOCAL hall only; opens /arena
  const arenaMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const enemyMarkersRef = useRef<mapboxgl.Marker[]>([])
  const playerMarkerRef = useRef<mapboxgl.Marker | null>(null)
  // Keyed by profile_id so refreshes UPDATE markers in place — tearing down
  // and rebuilding dozens of avatar <img> markers every poll caused real lag
  const otherPlayerMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const mapInitialized = useRef(false)
  const zoomRafPending = useRef(false)

  // Latest GPS fix, readable inside long-lived intervals. watchPosition
  // delivers a NEW location object every tick — keying effects on it tears
  // intervals down and refires fetches at GPS rate instead of their stated
  // periods, so effects key on hasLocation / grid cell and read this ref.
  const locationRef = useRef(location)
  useEffect(() => { locationRef.current = location }, [location])

  // Arriving from the Active Players list (/map?flat=&flng=): once the map is
  // ready, fly to that player's spot and drop a temporary pin.
  const didFocusRef = useRef(false)
  useEffect(() => {
    if (didFocusRef.current) return
    const sp = new URLSearchParams(window.location.search)
    const flat = parseFloat(sp.get('flat') ?? '')
    const flng = parseFloat(sp.get('flng') ?? '')
    if (isNaN(flat) || isNaN(flng)) return
    let tries = 0
    const iv = setInterval(() => {
      if (++tries > 60) { clearInterval(iv); return }
      if (!map.current) return
      clearInterval(iv)
      didFocusRef.current = true
      map.current.flyTo({ center: [flng, flat], zoom: 15.5, pitch: 30 })
      const el = document.createElement('div')
      el.textContent = '📍'
      el.style.fontSize = '34px'
      el.style.filter = 'drop-shadow(0 0 6px rgba(0,0,0,0.6))'
      const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([flng, flat]).addTo(map.current)
      setTimeout(() => mk.remove(), 9000)
      window.history.replaceState({}, '', '/map')
    }, 200)
    return () => clearInterval(iv)
  }, [])

  // Fly to a spot and drop a temporary pin (used by DM popups).
  function focusSpot(lat: number, lng: number) {
    if (!map.current) return
    map.current.flyTo({ center: [lng, lat], zoom: 15.5, pitch: 30 })
    const el = document.createElement('div')
    el.textContent = '📍'; el.style.fontSize = '34px'; el.style.filter = 'drop-shadow(0 0 6px rgba(0,0,0,0.6))'
    const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map.current)
    setTimeout(() => mk.remove(), 9000)
  }
  // A nearby player's spot + distance from us, if we can see them on the map.
  function playerSpot(id: string): { lat: number; lng: number; dist: number | null } | null {
    const p = nearbyPlayers.find(n => n.profile_id === id)
    if (!p) return null
    return { lat: p.lat, lng: p.lng, dist: location ? milesBetween(location.lat, location.lng, p.lat, p.lng) : null }
  }
  // Where your own dot is DRAWN (true position, or the fuzzed one) — the
  // home button flies here so it always centers your visible dot
  const displayedLocRef = useRef(location)
  const hasLocation = !!location
  // ~1km grid cell — spawn/gym queries only re-run when you actually move
  const gridLat = location ? location.lat.toFixed(2) : null
  const gridLng = location ? location.lng.toFixed(2) : null

  function showPvpToast(msg: string) {
    setPvpToast(msg)
    setTimeout(() => setPvpToast(''), 4000)
  }

  // HTML markers keep a fixed pixel size, so they visually dominate the map
  // as you zoom out. Hide them past zoom thresholds: zoomed to state level,
  // only the party-colored zone circles remain.
  function applyZoomVisibility() {
    // Coalesce to one pass per frame — 'zoom' fires continuously while
    // pinching and this walks every marker on the map
    if (zoomRafPending.current) return
    zoomRafPending.current = true
    requestAnimationFrame(() => {
      zoomRafPending.current = false
      applyZoomVisibilityNow()
    })
  }

  function applyZoomVisibilityNow() {
    const m = map.current
    if (!m) return
    const z = m.getZoom()
    const showEnemies = z >= 11 && mapPrefsRef.current.sprites // enemies: only at neighborhood zoom, and only if not toggled off
    const showPlayerMk = z >= 9   // players: city zoom
    // Enemies shrink as you zoom out so they stay in scale with player dots
    // (~30% at z11, full size at z15) — and past z15 they KEEP GROWING, up
    // to ~2× at street zoom, so you can zoom in and actually look at a
    // sprite and read its name (Michael 2026-07-21)
    const scale = z <= 15
      ? Math.max(0.3, 0.3 + (z - 11) * 0.175)
      : Math.min(2.0, 1 + (z - 15) * 0.32)
    enemyMarkersRef.current.forEach(mk => {
      const el = mk.getElement()
      el.style.display = showEnemies ? '' : 'none'
      const inner = el.querySelector('.em-scale') as HTMLElement | null
      if (inner) inner.style.transform = `scale(${scale})`
    })
    // Town halls: full size when zoomed into a town circle (z12+), shrink
    // fast as you pull back, and disappear entirely past city zoom — the
    // party-colored zone circles carry the story from state level out
    const showHalls = z >= 9
    const gymScale = Math.max(0.45, Math.min(1, 0.45 + (z - 9) * 0.183))
    gymMarkersRef.current.forEach(mk => {
      const el = mk.getElement()
      el.style.display = showHalls ? '' : 'none'
      const inner = el.querySelector('.gh-scale') as HTMLElement | null
      if (inner) inner.style.transform = `scale(${gymScale})`
    })
    // Arcades GROW slightly as you zoom out, then vanish below neighborhood
    // zoom (z12) so they never linger at city scale
    const showArcades = z >= 12
    const arcadeScale = Math.max(0.85, Math.min(1.4, 1.4 - (z - 12) * 0.13))
    arenaMarkersRef.current.forEach(mk => {
      const el = mk.getElement()
      el.style.display = showArcades ? '' : 'none' // twin behavior with the arcade
      const inner = el.querySelector('.arc-scale') as HTMLElement | null
      if (inner) inner.style.transform = `scale(${arcadeScale})`
    })
    arcadeMarkersRef.current.forEach(mk => {
      const el = mk.getElement()
      el.style.display = showArcades ? '' : 'none'
      const inner = el.querySelector('.arc-scale') as HTMLElement | null
      if (inner) inner.style.transform = `scale(${arcadeScale})`
    })
    otherPlayerMarkersRef.current.forEach(mk => { mk.getElement().style.display = showPlayerMk ? '' : 'none' })
  }


  // Load map-visibility preferences (migrates the old show_players flag)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('map_show_prefs')
      if (saved) {
        const p = JSON.parse(saved)
        setMapPrefs({ me: p.me !== false, dems: p.dems !== false, reps: p.reps !== false, sprites: p.sprites !== false })
      } else if (localStorage.getItem('show_players') === 'false') {
        setMapPrefs({ me: true, dems: false, reps: false, sprites: true })
      }
    } catch {}
  }, [])

  // Re-run marker visibility when the sprites switch flips (zoom handler
  // only fires on zoom, not on toggle)
  useEffect(() => { applyZoomVisibility() }, [mapPrefs.sprites]) // eslint-disable-line react-hooks/exhaustive-deps

  // Location fuzz is a SERVER setting (it changes what others see), shared
  // with the Map Settings page — both menus read/write the same flag
  const [fuzzBusy, setFuzzBusy] = useState(false)
  const locationFuzz = !!(profile as any)?.location_fuzz
  async function toggleFuzz() {
    if (fuzzBusy) return
    setFuzzBusy(true)
    try {
      await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_fuzz: !locationFuzz }),
      })
      await refetch()
    } catch {}
    setFuzzBusy(false)
  }

  function toggleMapPref(key: 'me' | 'dems' | 'reps' | 'sprites') {
    setMapPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem('map_show_prefs', JSON.stringify(next))
      return next
    })
  }

  // ── Map initialization (once — must NOT re-run per GPS tick) ─────────────
  // Deps include the loading flags because the container div only renders
  // after BOTH location and profile finish loading — keying on hasLocation
  // alone can fire while the loading screen is still up (no container) and
  // then never retry.
  useEffect(() => {
    const loc = locationRef.current
    if (!loc || !mapContainer.current || mapInitialized.current) return
    mapInitialized.current = true

    // Open the camera on the position the map SHOWS for you — with location
    // fuzz on, that's the offset spot, not your true GPS position
    const fuzzOn = !!(profile as any)?.location_fuzz && !!profile?.id
    const startAt = fuzzOn ? fuzzOffset(profile!.id, loc.lat, loc.lng) : loc
    displayedLocRef.current = startAt

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [startAt.lng, startAt.lat],
      zoom: 16,
      pitch: 30,
    })

    // Clean control stack (Michael): zoom in / zoom out / locate-me, ONE box.
    // No compass (nobody rotates), no floating 📍 pill — the locate button is
    // appended INTO mapbox's own zoom group so all three share a pill.
    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')
    {
      const zoomGroup = mapContainer.current?.querySelector('.mapboxgl-ctrl-zoom-out')?.parentElement
      if (zoomGroup) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.title = 'Zoom to my location'
        btn.setAttribute('aria-label', 'Zoom to my location')
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2.2" stroke-linecap="round" style="display:block;margin:auto"><circle cx="12" cy="12" r="6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
        btn.addEventListener('click', () => {
          const l = displayedLocRef.current ?? locationRef.current
          if (l && map.current) map.current.flyTo({ center: [l.lng, l.lat], zoom: 16, pitch: 30 })
        })
        zoomGroup.appendChild(btn)
      }
    }

    map.current.on('zoom', applyZoomVisibility)

    // iOS PWA: a canvas created or sized while the page was backgrounded can
    // paint blank — nudge the map whenever we come back to the foreground
    const onVis = () => { if (!document.hidden) map.current?.resize() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      map.current?.remove()
      map.current = null
      mapInitialized.current = false
    }
  }, [hasLocation, locationLoading, profileLoading])

  // ── Own player marker ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !location) return

    // "Show me on map" off → no own marker (and no broadcast, see below)
    if (!mapPrefs.me) {
      playerMarkerRef.current?.remove()
      playerMarkerRef.current = null
      return
    }

    // With location fuzz on, YOUR dot shows the approximate spot others
    // see (plus a dashed area circle) — so the toggle is visibly real
    const fuzzOn = !!(profile as any)?.location_fuzz && !!profile?.id
    const shown = fuzzOn ? fuzzOffset(profile!.id, location.lat, location.lng) : location
    displayedLocRef.current = shown

    // Approximate-area circle (drawn only while fuzzing)
    try {
      const m = map.current
      if (m.isStyleLoaded()) {
        const circle = {
          type: 'FeatureCollection' as const,
          features: fuzzOn ? [{
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [makeCircleCoords(shown.lng, shown.lat, 1.0)] },
            properties: {},
          }] : [],
        }
        if (m.getSource('self-approx')) {
          (m.getSource('self-approx') as mapboxgl.GeoJSONSource).setData(circle)
        } else {
          m.addSource('self-approx', { type: 'geojson', data: circle })
          m.addLayer({
            id: 'self-approx-fill',
            type: 'fill',
            source: 'self-approx',
            paint: { 'fill-color': profile?.party === 'democrat' ? '#3b82f6' : '#ef4444', 'fill-opacity': 0.12 },
          })
          m.addLayer({
            id: 'self-approx-line',
            type: 'line',
            source: 'self-approx',
            paint: {
              'line-color': profile?.party === 'democrat' ? '#60a5fa' : '#f87171',
              'line-width': 2,
              'line-dasharray': [2, 2],
              'line-opacity': 0.7,
            },
          })
        }
      }
    } catch {}

    if (playerMarkerRef.current) {
      playerMarkerRef.current.setLngLat([shown.lng, shown.lat])
    } else {
      const color = profile?.show_party === false ? '#f3f4f6'
        : profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
      const el = document.createElement('div')
      if (profile?.avatar_url) {
        el.innerHTML = `<img src="${esc(profile.avatar_url)}" style="
          width:34px;height:34px;border-radius:50%;object-fit:cover;
          border:3px solid ${color};
          box-shadow:0 0 0 2px white, 0 0 12px ${color}88;
          cursor:pointer;" />`
      } else {
        el.style.cssText = `
          width: 20px; height: 20px;
          background: ${color}; border: 3px solid white; border-radius: 50%;
          box-shadow: 0 0 0 3px ${color}, 0 0 15px ${color}88;
          cursor: pointer;
        `
      }
      // Tapping your own dot opens the self sheet (profile / messages /
      // nearest town hall)
      el.addEventListener('click', () => setSelfSheet(true))
      playerMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([shown.lng, shown.lat])
        .addTo(map.current!)
    }
  }, [location, profile, mapPrefs.me])

  // ── Broadcast own location every 10s (unless hiding from the map) ────────
  useEffect(() => {
    if (!hasLocation || !mapPrefs.me) return
    const broadcast = () => {
      const loc = locationRef.current
      if (!loc) return
      fetch('/api/players/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: loc.lat, lng: loc.lng }),
      }).catch(() => {})
    }
    broadcast()
    const interval = setInterval(broadcast, 10000)
    return () => clearInterval(interval)
  }, [hasLocation, mapPrefs.me])

  // ── Fetch & render nearby players every 8s ────────────────────────────────
  // Always fetch (the dropdown's "Local Players Online" count needs it);
  // the dems/reps toggles only filter which players get MARKERS.
  useEffect(() => {
    if (!hasLocation) return

    const fetchAndRender = async () => {
      const loc = locationRef.current
      if (!map.current || !loc) return
      try {
        const res = await fetch(`/api/players/nearby?lat=${loc.lat}&lng=${loc.lng}`)
        const data = await res.json()
        const players: NearbyPlayer[] = data.players ?? []
        setNearbyPlayers(players)

        if (!map.current) return

        const visiblePlayers = players.filter(p =>
          p.party === 'democrat' ? mapPrefs.dems
            : p.party === 'republican' ? mapPrefs.reps
            : (mapPrefs.dems || mapPrefs.reps)) // hidden affiliation: show unless everything is off

        // Diff against existing markers: move the ones that stayed, drop the
        // ones that left, create only the genuinely new
        const keep = new Set(visiblePlayers.map(p => p.profile_id))
        for (const [id, mk] of otherPlayerMarkersRef.current) {
          if (!keep.has(id)) {
            mk.remove()
            otherPlayerMarkersRef.current.delete(id)
          }
        }

        visiblePlayers.forEach(player => {
          const existing = otherPlayerMarkersRef.current.get(player.profile_id)
          if (existing) {
            existing.setLngLat([player.lng, player.lat])
            return
          }
          // White/neutral ring if party is hidden, otherwise party color
          const color = player.party === 'democrat' ? '#2563eb'
            : player.party === 'republican' ? '#dc2626'
            : '#f3f4f6'
          const dotEmoji = player.party === 'democrat' ? '🔵'
            : player.party === 'republican' ? '🔴' : '⚪'
          const el = document.createElement('div')
          el.style.cursor = 'pointer'
          // Profile photo inside the party ring when they have one
          const face = player.avatar_url
            ? `<img src="${esc(player.avatar_url)}" style="
                 width:30px;height:30px;border-radius:50%;object-fit:cover;
                 border:3px solid ${color};
                 box-shadow:0 0 8px ${color}88, 0 2px 6px rgba(0,0,0,0.5);
               " />`
            : `<div style="
                 width:16px;height:16px;border-radius:50%;
                 background:${color};border:2px solid white;
                 box-shadow:0 0 0 2px ${color},0 0 8px ${color}66;
               "></div>`
          el.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
              ${face}
              <div style="
                background:rgba(0,0,0,0.85);color:white;
                font-size:10px;font-weight:600;padding:2px 5px;
                border-radius:4px;white-space:nowrap;
                border:1px solid ${color}66;
              ">${dotEmoji} ${esc(player.username || 'Player')}</div>
            </div>
          `
          el.addEventListener('click', () => setSelectedPlayer(player))

          const marker = new mapboxgl.Marker({ element: el, anchor: 'top' })
            .setLngLat([player.lng, player.lat])
            .addTo(map.current!)
          otherPlayerMarkersRef.current.set(player.profile_id, marker)
        })
        applyZoomVisibility()
      } catch {
        // Player markers are non-critical — silently ignore
      }
    }

    // stage 4: other players load last on the first paint, instantly after
    const firstDelay = playersStartedRef.current ? 0 : (gymsLoaded ? 900 : 1800)
    playersStartedRef.current = true
    const t = setTimeout(fetchAndRender, firstDelay)
    const interval = setInterval(fetchAndRender, 8000)
    return () => {
      clearTimeout(t)
      clearInterval(interval)
      otherPlayerMarkersRef.current.forEach(m => m.remove())
      otherPlayerMarkersRef.current = new Map()
    }
  }, [hasLocation, mapPrefs.dems, mapPrefs.reps])

  // Incoming PvP pull-in now lives in the (game) layout — it grabs the
  // defender from ANY screen, not just the map.

  // ── Poll sent challenge for result every 3s ───────────────────────────────
  useEffect(() => {
    if (!sentChallenge || !profile) return

    const poll = async () => {
      try {
        const res = await fetch(`/api/pvp/${sentChallenge.id}`)
        const data = await res.json()

        if (data.status === 'accepted' || data.status === 'completed') {
          // Accepted = the defender armed the fight — go fight it live
          setSentChallenge(null)
          router.push(`/battle/pvp?id=${sentChallenge.id}`)
        } else if (['declined', 'expired', 'cancelled'].includes(data.status)) {
          const reason = data.status === 'declined' ? 'declined your challenge' : "didn't respond in time"
          showPvpToast(`${sentChallenge.opponentName} ${reason}`)
          setSentChallenge(null)
        }
      } catch {}
    }

    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [sentChallenge, profile, refetch])

  // ── Send a challenge ───────────────────────────────────────────────────────
  async function sendChallenge(player: NearbyPlayer) {
    if (!profile) return
    setChallengeLoading(true)
    setSelectedPlayer(null)
    try {
      const res = await fetch('/api/pvp/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defender_id: player.profile_id }),
      })
      const data = await res.json()
      if (res.ok && (data.status === 'accepted' || data.status === 'completed')) {
        // Bot defenders auto-accept — the fight is armed, go throw hands
        router.push(`/battle/pvp?id=${data.id}`)
      } else if (res.ok) {
        setSentChallenge({ id: data.id, opponentName: player.username })
      } else {
        showPvpToast(`❌ ${data.message || data.error || 'Challenge failed'}`)
      }
    } catch {
      showPvpToast('❌ Could not send challenge')
    } finally {
      setChallengeLoading(false)
    }
  }

  // ── Poll the inbox for new incoming messages every 8s ────────────────────
  // Open messaging: anyone can message you (unless blocked/incognito). New
  // messages pop a card with Reply / Snooze / Block. Snoozes live in
  // localStorage per sender.
  useEffect(() => {
    if (!hasLocation) return
    const poll = async () => {
      try {
        const since = lastInboxRef.current
        lastInboxRef.current = new Date().toISOString()
        const res = await fetch(`/api/chat/inbox?since=${encodeURIComponent(since)}`)
        const data = await res.json()
        for (const m of data.messages ?? []) {
          if (m.sender_id === activeChatUserId) continue // already chatting
          const snoozedUntil = parseInt(localStorage.getItem(`chat_snooze_${m.sender_id}`) || '0')
          if (snoozedUntil > Date.now()) continue
          setIncomingMsg(m)
          break
        }
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 8000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLocation, activeChatUserId])

  // ── Poll active chat messages every 3s ────────────────────────────────────
  useEffect(() => {
    if (!activeChatUserId) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/chat/${activeChatUserId}`)
        const data = await res.json()
        if (data.messages) setChatMessages(data.messages)
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [activeChatUserId])

  // Scroll chat to bottom when messages update
  useEffect(() => {
    chatBoxRef.current?.scrollTo({ top: chatBoxRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatMessages])

  // ── Open a player's photo album (avatar + any extra photos) ───────────────
  async function openPlayerAlbum(player: NearbyPlayer) {
    // Show the avatar immediately, then fetch the full album
    setAlbum({ title: player.username, photos: player.avatar_url ? [{ id: 'avatar', url: player.avatar_url }] : [] })
    try {
      const res = await fetch(`/api/players/${player.profile_id}/profile`)
      const data = await res.json()
      if (Array.isArray(data.photos) && data.photos.length) {
        setAlbum({ title: player.username, photos: data.photos })
      }
    } catch {}
  }

  // ── Start a chat with a player (opens the chat overlay directly) ──────────
  function startChat(player: NearbyPlayer) {
    setSelectedPlayer(null)
    setActiveChatUserId(player.profile_id)
    setActiveChatUsername(player.username)
    setChatMessages([])
  }

  // ── Incoming message popup actions ────────────────────────────────────────
  function replyToMsg() {
    if (!incomingMsg) return
    setActiveChatUserId(incomingMsg.sender_id)
    setActiveChatUsername(incomingMsg.sender_username)
    setChatMessages([])
    setIncomingMsg(null)
  }

  function snoozeMsg() {
    if (!incomingMsg) return
    // Mute this sender's popups for 8 hours (they can still send)
    localStorage.setItem(`chat_snooze_${incomingMsg.sender_id}`, String(Date.now() + 8 * 3600 * 1000))
    setIncomingMsg(null)
    showPvpToast(`😴 ${incomingMsg.sender_username} snoozed for 8 hours`)
  }

  function blockMsgSender() {
    if (!incomingMsg) return
    const { sender_id, sender_username } = incomingMsg
    setIncomingMsg(null)
    blockPlayer(sender_id, sender_username)
  }

  // ── Send a direct message ─────────────────────────────────────────────────
  async function sendChatMessage() {
    if (!chatInput.trim() || !activeChatUserId) return
    setChatSending(true)
    try {
      const res = await fetch(`/api/chat/${activeChatUserId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chatInput.trim() }),
      })
      const data = await res.json()
      if (data.message) {
        setChatMessages(prev => [...prev, data.message])
        setChatInput('')
      }
    } catch {}
    setChatSending(false)
  }

  // ── Block a player ────────────────────────────────────────────────────────
  async function blockPlayer(playerId: string, username: string) {
    setSelectedPlayer(null)
    if (activeChatUserId === playerId) {
      setActiveChatUserId(null)
      setActiveChatUsername('')
      setChatMessages([])
    }
    try {
      await fetch('/api/players/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked_id: playerId }),
      })
      showPvpToast(`🚫 ${username} blocked`)
      // Remove their marker immediately
      setNearbyPlayers(prev => prev.filter(p => p.profile_id !== playerId))
    } catch {}
  }

  // ── Gyms (refetch only when moving to a new ~1km grid cell) ───────────────
  // Cache-first: last fetch is rendered instantly (hall positions never move;
  // holder colors may be seconds stale until the fresh copy lands right after)
  useEffect(() => {
    if (!gridLat || !gridLng) return
    const loc = locationRef.current
    if (!loc) return

    const firstFit = (arr: Gym[]) => {
      // opening shot: the player AND their closest town hall in one frame
      if (didFitRef.current || !map.current || !arr.length) return
      const at = displayedLocRef.current ?? loc
      const nearest = [...arr].sort((a, b) =>
        Math.hypot(a.latitude - at.lat, a.longitude - at.lng) -
        Math.hypot(b.latitude - at.lat, b.longitude - at.lng))[0]
      if (!nearest || milesBetween(at.lat, at.lng, nearest.latitude, nearest.longitude) > 30) return
      didFitRef.current = true
      const b = new mapboxgl.LngLatBounds([at.lng, at.lat], [at.lng, at.lat])
      b.extend([nearest.longitude, nearest.latitude])
      map.current.fitBounds(b, { padding: { top: 150, bottom: 230, left: 70, right: 70 }, maxZoom: 15.5, pitch: 30, duration: 1400 })
    }

    try {
      const c = JSON.parse(localStorage.getItem('gyms_cache_v1') || 'null')
      if (c && Date.now() - c.at < 15 * 60_000 && milesBetween(c.lat, c.lng, loc.lat, loc.lng) < 2) {
        setGyms(g => (g.length ? g : c.gyms))
        setGymsLoaded(true)
        firstFit(c.gyms)
      }
    } catch {}

    fetch(`/api/gyms?lat=${loc.lat}&lng=${loc.lng}`)
      .then(r => r.json())
      .then(data => {
        const arr = data.gyms || []
        setGyms(arr)
        setGymsLoaded(true)
        firstFit(arr)
        try { localStorage.setItem('gyms_cache_v1', JSON.stringify({ at: Date.now(), lat: loc.lat, lng: loc.lng, gyms: arr })) } catch {}
      })
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridLat, gridLng])

  useEffect(() => {
    if (!map.current || gyms.length === 0) return

    const addGyms = () => {
      // ── Zone circles (Mapbox GeoJSON layers, rendered below markers) ───────
      const circleData = {
        type: 'FeatureCollection' as const,
        features: gyms.map(gym => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [makeCircleCoords(gym.longitude, gym.latitude, gym.radius_miles || DEFAULT_RADIUS_MILES)],
          },
          properties: { party: gym.holder_party ?? 'none' },
        })),
      }

      if (map.current!.getSource('gym-zones')) {
        (map.current!.getSource('gym-zones') as mapboxgl.GeoJSONSource).setData(circleData)
      } else {
        map.current!.addSource('gym-zones', { type: 'geojson', data: circleData })

        // Fill: more visible when zoomed out (you can see the whole zone),
        // fades when zoomed in (you're inside the circle)
        map.current!.addLayer({
          id: 'gym-zones-fill',
          type: 'fill',
          source: 'gym-zones',
          paint: {
            'fill-color': ['match', ['get', 'party'], 'democrat', '#3b82f6', 'republican', '#ef4444', '#e5e7eb'],
            'fill-opacity': [
              'interpolate', ['linear'], ['zoom'],
              8,  0.25,
              12, 0.18,
              14, 0.12,
              17, 0.06,
            ],
          },
        })

        // Outline: always visible, thicker when zoomed out
        map.current!.addLayer({
          id: 'gym-zones-outline',
          type: 'line',
          source: 'gym-zones',
          paint: {
            'line-color': ['match', ['get', 'party'], 'democrat', '#60a5fa', 'republican', '#f87171', '#d1d5db'],
            'line-opacity': [
              'interpolate', ['linear'], ['zoom'],
              8,  0.95,
              14, 0.75,
              17, 0.50,
            ],
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              8,  3,
              14, 2,
              17, 1.5,
            ],
          },
        })
      }

      renderGymMarkers()
    }

    // ── Gym building markers (HTML, expensive) ──────────────────────────────
    // Rendered for halls in the CURRENT VIEW (up to 30, nearest to the view
    // center first) and refreshed on pan/zoom — every circle you can see
    // gets its building, but off-screen halls cost nothing. (The old
    // nearest-25-to-the-player cap left far-off circles building-less.)
    const renderGymMarkers = () => {
      const m = map.current
      if (!m) return
      const b = m.getBounds()
      if (!b) return
      const padLat = (b.getNorth() - b.getSouth()) * 0.15
      const padLng = (b.getEast() - b.getWest()) * 0.15
      const c = m.getCenter()
      const visible = gyms
        .filter(g =>
          g.latitude > b.getSouth() - padLat && g.latitude < b.getNorth() + padLat &&
          g.longitude > b.getWest() - padLng && g.longitude < b.getEast() + padLng)
        .sort((a, g) =>
          Math.hypot(a.latitude - c.lat, a.longitude - c.lng) -
          Math.hypot(g.latitude - c.lat, g.longitude - c.lng))
        .slice(0, 30)

      const keep = new Set(visible.map(g => g.id))
      for (const [id, mk] of gymMarkersRef.current) {
        if (!keep.has(id)) {
          mk.remove()
          gymMarkersRef.current.delete(id)
        }
      }

      // ── Arcade — ONE only, next to the hall nearest the PLAYER ────────────
      const pl = locationRef.current
      const nearestGym = pl
        ? gyms.reduce<Gym | null>((best, g) => {
            const d = Math.hypot(g.latitude - pl.lat, g.longitude - pl.lng)
            return !best || d < Math.hypot(best.latitude - pl.lat, best.longitude - pl.lng) ? g : best
          }, null)
        : null
      const arcadeKeep = nearestGym ? new Set([nearestGym.id]) : new Set<string>()
      for (const [id, mk] of arcadeMarkersRef.current) {
        if (!arcadeKeep.has(id)) { mk.remove(); arcadeMarkersRef.current.delete(id) }
      }
      if (nearestGym && !arcadeMarkersRef.current.has(nearestGym.id)) {
        const g = nearestGym
        const arcLng = g.longitude - 0.0062 / Math.cos(g.latitude * Math.PI / 180) // ~0.43 mi west
        const el = document.createElement('div')
        el.innerHTML = `
          <div class="arc-scale" style="transform-origin:bottom center;transition:transform 150ms ease-out;">
            <img src="/arcade.png" alt="Arcade" draggable="false" style="
              width:58px;height:auto;pointer-events:none;
              filter:drop-shadow(0 0 6px #a855f7) drop-shadow(0 3px 5px rgba(0,0,0,0.6));" />
          </div>`
        el.style.cursor = 'pointer'
        el.title = 'Arcade'
        el.addEventListener('click', () => router.push('/arcade'))
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([arcLng, g.latitude])
          .addTo(map.current!)
        arcadeMarkersRef.current.set(g.id, marker)
      }

      // ── Arena — ONE only, east of the hall nearest the PLAYER ────────────
      for (const [id, mk] of arenaMarkersRef.current) {
        if (!arcadeKeep.has(id)) { mk.remove(); arenaMarkersRef.current.delete(id) }
      }
      if (nearestGym && !arenaMarkersRef.current.has(nearestGym.id)) {
        const g = nearestGym
        const arenaLng = g.longitude + 0.0062 / Math.cos(g.latitude * Math.PI / 180) // ~0.43 mi east
        const el = document.createElement('div')
        el.innerHTML = `
          <div class="arc-scale" style="transform-origin:bottom center;transition:transform 150ms ease-out;">
            <img src="/arena.png" alt="Arena" draggable="false" style="
              width:58px;height:auto;pointer-events:none;
              filter:drop-shadow(0 0 6px #d97706) drop-shadow(0 3px 5px rgba(0,0,0,0.6));" />
          </div>`
        el.style.cursor = 'pointer'
        el.title = 'The Arena'
        el.addEventListener('click', () => router.push('/arena'))
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([arenaLng, g.latitude])
          .addTo(map.current!)
        arenaMarkersRef.current.set(g.id, marker)
      }

      visible.forEach(gym => {
        if (gymMarkersRef.current.has(gym.id)) return
        const partyColor = gym.holder_party === 'democrat' ? '#2563eb'
          : gym.holder_party === 'republican' ? '#dc2626' : '#6b7280'
        const flagEmoji = gym.holder_party === 'democrat' ? '🔵'
          : gym.holder_party === 'republican' ? '🔴' : '⚪'
        // Town hall building cutout with the city name pill underneath —
        // party-colored glow shows who holds it from across the map
        const el = document.createElement('div')
        el.innerHTML = `
          <div class="gh-scale" style="transform-origin:bottom center;transition:transform 150ms ease-out;">
            <div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;">
              <img src="/halls/hall_intact.webp" alt="" draggable="false" style="
                width:58px;height:auto;pointer-events:none;
                filter:drop-shadow(0 0 7px ${partyColor}) drop-shadow(0 0 2px ${partyColor}) drop-shadow(0 3px 5px rgba(0,0,0,0.65));
              " />
              <div style="
                background:rgba(0,0,0,0.88);border:2px solid ${partyColor};
                border-radius:8px;padding:2px 7px;margin-top:2px;display:flex;
                align-items:center;gap:4px;white-space:nowrap;
                box-shadow:0 2px 8px rgba(0,0,0,0.5);
              ">
                <span style="color:white;font-size:11px;font-weight:700;">${esc(gym.city_name)}</span>
                <span style="font-size:10px;">${flagEmoji}</span>
              </div>
            </div>
          </div>
        `
        el.style.cursor = 'pointer'
        el.addEventListener('click', () => router.push(`/townhall/${gym.id}`))

        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([gym.longitude, gym.latitude])
          .addTo(map.current!)
        gymMarkersRef.current.set(gym.id, marker)
      })
      applyZoomVisibility()
    }

    // isStyleLoaded() can be false even after 'load' already fired, and
    // 'load' fires only once — waiting on it can miss forever. 'idle' fires
    // again whenever the map settles, so a missed check always recovers.
    if (map.current.isStyleLoaded()) {
      addGyms()
    } else {
      map.current.once('idle', addGyms)
    }
    map.current.on('moveend', renderGymMarkers)

    return () => {
      map.current?.off('idle', addGyms)
      map.current?.off('moveend', renderGymMarkers)
      gymMarkersRef.current.forEach(m => m.remove())
      gymMarkersRef.current = new Map()
      arcadeMarkersRef.current.forEach(m => m.remove())
      arcadeMarkersRef.current = new Map()
    }
  }, [gyms, router])

  // ── Enemy spawns ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gridLat || !gridLng || !profile) return
    if (!gymsLoaded) return // stage 3: sprites come after the halls are up
    const loc = locationRef.current
    if (!loc) return

    // SHARED spawns (server-owned): every player sees the same enemies in the
    // same places. Halls re-roll their drop every 10 minutes, spawns live 15;
    // a spawn you caught is filtered server-side, one you just KO'd is hidden
    // locally until the next generation replaces it.
    let cancelled = false
    fetch(`/api/spawns?lat=${loc.lat}&lng=${loc.lng}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const rows: { id: string; enemy_id: string; lat: number; lng: number }[] = d.spawns ?? []
        const isAlive = (id: string) => {
          try { return !localStorage.getItem(`spawn_dead_${id}`) } catch { return true }
        }
        const visible: SpawnedEnemy[] = []
        for (const r of rows) {
          if (!isAlive(r.id)) continue
          if (milesBetween(loc.lat, loc.lng, r.lat, r.lng) > 5) continue
          const enemy = getEnemyById(r.enemy_id)
          if (!enemy) continue
          visible.push({ id: r.id, enemy, lat: r.lat, lng: r.lng })
        }
        setSpawnedEnemies(visible)
      })
      .catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridLat, gridLng, profile, gyms, gymsLoaded, spawnTick])

  useEffect(() => {
    if (!map.current || spawnedEnemies.length === 0) return

    const addEnemies = () => {
      // Inject marker animation styles once
      if (!document.getElementById('enemy-marker-styles')) {
        const s = document.createElement('style')
        s.id = 'enemy-marker-styles'
        s.textContent = `
          .em-scale { transform-origin: top center; transition: transform 150ms ease-out; }
          .em-wrap { display:flex; flex-direction:column; align-items:center; cursor:pointer; position:relative; animation:emBob 2.6s ease-in-out infinite; }
          .em-pulse { position:absolute; border-radius:14px; transform:rotate(45deg); animation:emPulse 2s ease-out infinite; pointer-events:none; }
          .em-img  { border-radius:12px; transform:rotate(45deg); overflow:hidden; position:relative; z-index:1; }
          .em-img img { transform:rotate(-45deg) scale(1.42); }
          .em-name { font-size:10px; font-weight:700; color:white; background:rgba(0,0,0,0.82); padding:2px 6px; border-radius:5px; margin-top:12px; white-space:nowrap; border:1px solid rgba(255,255,255,0.12); }
          .em-tier { font-size:8px; font-weight:800; padding:1px 4px; border-radius:3px; margin-top:1px; text-transform:uppercase; letter-spacing:.5px; }
          @keyframes emPulse { 0%{transform:rotate(45deg) scale(1);opacity:.55} 70%{transform:rotate(45deg) scale(1.55);opacity:0} 100%{opacity:0} }
          @keyframes emBob   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        `
        document.head.appendChild(s)
      }

      spawnedEnemies.forEach(spawn => {
        const tc = spawn.enemy.tier === 'legendary' ? '#f59e0b'
          : spawn.enemy.tier === 'rare' ? '#8b5cf6' : '#6b7280'
        const isLeg = spawn.enemy.tier === 'legendary'
        const sz = isLeg ? 42 : 38
        const pulseOff = Math.floor(sz * 0.12)

        const el = document.createElement('div')
        el.innerHTML = `
          <div class="em-scale">
            <div class="em-wrap">
              <div class="em-pulse"
                style="width:${sz + pulseOff * 2}px;height:${sz + pulseOff * 2}px;
                       top:-${pulseOff}px;left:-${pulseOff}px;
                       border:2px solid ${tc}; background:${tc}18;">
              </div>
              <div class="em-img"
                style="width:${sz}px;height:${sz}px;
                       border:3px solid ${tc};
                       background:radial-gradient(circle at 50% 32%, ${tc}30 0%, #101828 75%);
                       box-shadow:0 0 14px ${tc}77, 0 4px 14px rgba(0,0,0,0.6);">
                <img src="${spawn.enemy.image}"
                  style="width:100%;height:100%;object-fit:contain;padding:3px;" />
              </div>
              <div class="em-name">${spawn.enemy.name}</div>
              <div class="em-tier"
                style="background:${tc}22;color:${tc};border:1px solid ${tc}44;">
                ${spawn.enemy.tier}
              </div>
            </div>
          </div>
        `
        el.addEventListener('click', () => {
          // Battle range: must be within 1 mile of the enemy
          const loc = locationRef.current
          if (!loc) return
          const dist = milesBetween(loc.lat, loc.lng, spawn.lat, spawn.lng)
          if (dist > 1) {
            showPvpToast(`🚶 ${spawn.enemy.name} is ${dist.toFixed(1)} mi away — get within 1 mile to battle`)
            return
          }
          router.push(`/battle?enemy=${spawn.enemy.id}&spawn=${spawn.id}`)
        })

        const marker = new mapboxgl.Marker({ element: el, anchor: 'top' })
          .setLngLat([spawn.lng, spawn.lat])
          .addTo(map.current!)
        enemyMarkersRef.current.push(marker)
      })
      applyZoomVisibility()
    }

    // Remove the previous set — enemy markers otherwise accumulate on every
    // spawn regeneration, leaving stale clickable enemies on the map
    enemyMarkersRef.current.forEach(m => m.remove())
    enemyMarkersRef.current = []

    // Same 'load'-vs-'idle' pitfall as the gym effect: 'load' fires once and
    // may already be gone, silently dropping all enemy markers
    if (map.current.isStyleLoaded()) addEnemies()
    else map.current.once('idle', addEnemies)

    return () => {
      map.current?.off('idle', addEnemies)
      enemyMarkersRef.current.forEach(m => m.remove())
      enemyMarkersRef.current = []
    }
  }, [spawnedEnemies, router])

  // ── FP toast ──────────────────────────────────────────────────────────────
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

  // Only hard-block if we truly have no location. With the fallback location
  // (desktop / denied), `location` is set even when `locationError` is — the
  // map renders and a small banner explains it.
  if (locationError && !location) {
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
    <div className="relative overflow-hidden" style={{ height: 'calc(100dvh - 5rem)' }}>
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* Fallback-location notice (desktop / location denied) */}
      {locationError && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 bg-yellow-900/85 border border-yellow-700/60 text-yellow-100 text-[11px] font-medium px-3 py-1.5 rounded-full shadow-lg text-center max-w-[92%]">
          📍 {locationError}
        </div>
      )}

      {/* ── HUD: Top Left — ONE pill system (Michael: buttons felt thrown
          together). Every pill: same height, same glass, same radius. Row 1
          is status (party home · FP · steps), row 2 is actions. ─────────── */}
      <div className="absolute left-4 z-20 flex flex-col gap-1.5" style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}>
        {/* ONE status bar (Michael): party/home · FP · Local Players · steps
            joined in a single pill, hairline dividers between segments */}
        <div className="h-9 bg-black/70 backdrop-blur border border-white/10 rounded-full pl-1 pr-2.5 flex items-center gap-1.5 max-w-[calc(100vw-2rem)]">
          {/* party home button → the battlemap home page. BIG hit target —
              the icon rides in a 28px disc on a full-height button */}
          <button onClick={() => router.push('/')} aria-label="Battle Map home"
            className="h-9 flex items-center gap-1.5 shrink-0 active:scale-95 transition">
            <span className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: `${partyColor}26` }}>
              <Home size={20} strokeWidth={2.6} style={{ color: partyColor }} />
            </span>
            <span className="text-white text-[11px] font-bold">
              {profile?.party === 'democrat' ? 'Democrats' : 'Republicans'}
            </span>
          </button>
          <div className="w-px h-3.5 bg-white/15 shrink-0" />
          {/* Tap FP → shop */}
          <button onClick={() => router.push('/shop')}
            className="text-yellow-400 text-[11px] font-bold hover:text-yellow-300 active:scale-95 transition whitespace-nowrap shrink-0">
            ⚡ {profile?.fp_balance?.toLocaleString() || 0}
          </button>
          <div className="w-px h-3.5 bg-white/15 shrink-0" />
          {/* Local Players → active players screen */}
          <button onClick={() => router.push('/active')}
            className="flex items-center gap-1 active:scale-95 transition shrink-0">
            <span className="text-[11px]">✊</span>
            <span className="text-white text-[11px] font-bold whitespace-nowrap">Local Players</span>
          </button>
          <div className="w-px h-3.5 bg-white/15 shrink-0" />
          {/* Steps — tap opens the Step Tracker */}
          <button onClick={() => router.push('/steps')}
            className="text-white text-[11px] font-bold whitespace-nowrap active:scale-95 transition shrink-0">
            👟 {steps.toLocaleString()}
          </button>
        </div>

        {/* row 2: See on map — far left, under the party/home pill */}
        <div className="flex items-start gap-1.5">
        <div className="relative">
          <button
            onClick={() => setShowMapMenu(v => !v)}
            className={`h-9 backdrop-blur rounded-full px-3 flex items-center gap-1.5 transition-all active:scale-95 ${
              showMapMenu ? 'bg-blue-900/80 border border-blue-500/60' : 'bg-black/70 border border-white/10'
            }`}
          >
            <span className="text-white text-xs font-bold">See on map</span>
            <span className="text-gray-400 text-[9px]">{showMapMenu ? '▲' : '▼'}</span>
          </button>

          {showMapMenu && (
            <>
              {/* Click-away catcher: tapping anywhere outside closes the bubble */}
              <div className="fixed inset-0 z-0" onClick={() => setShowMapMenu(false)} />
              <div className="absolute top-full left-0 mt-2 z-10 w-56 bg-gray-900/95 backdrop-blur rounded-xl border border-gray-700 shadow-2xl p-1.5">
                {([
                  { key: 'me' as const,      label: '📍 Show me on map' },
                  { key: 'dems' as const,    label: '🔵 Show Democrats' },
                  { key: 'reps' as const,    label: '🔴 Show Republicans' },
                  { key: 'sprites' as const, label: '👾 Show Sprites' },
                ]).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between px-2 py-2">
                    <span className="text-white text-xs font-medium">{label}</span>
                    <button
                      onClick={() => toggleMapPref(key)}
                      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                        mapPrefs[key] ? 'bg-green-600' : 'bg-gray-700'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                        mapPrefs[key] ? 'left-6' : 'left-0.5'
                      }`} />
                      <span className={`absolute inset-0 flex items-center text-[8px] font-black ${
                        mapPrefs[key] ? 'justify-start pl-1.5 text-white' : 'justify-end pr-1 text-gray-400'
                      }`}>
                        {mapPrefs[key] ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between px-2 py-2">
                  <span className="text-white text-xs font-medium">🎲 Offset location ~1 mi</span>
                  <button
                    onClick={toggleFuzz}
                    disabled={fuzzBusy}
                    className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60 ${
                      locationFuzz ? 'bg-green-600' : 'bg-gray-700'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                      locationFuzz ? 'left-6' : 'left-0.5'
                    }`} />
                    <span className={`absolute inset-0 flex items-center text-[8px] font-black ${
                      locationFuzz ? 'justify-start pl-1.5 text-white' : 'justify-end pr-1 text-gray-400'
                    }`}>
                      {locationFuzz ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
                <button
                  onClick={() => { setShowMapMenu(false); router.push('/settings/map') }}
                  className="w-full text-left px-2 py-2 mt-1 border-t border-gray-700 text-blue-400 hover:text-blue-300 text-xs font-bold transition">
                  ⚙️ Full Map Settings →
                </button>
                <div className="pt-1 pb-1 px-2 flex items-center justify-between">
                  <span className="text-gray-400 text-[11px]">Local Players Online:</span>
                  <span className="text-green-400 text-xs font-bold">{nearbyPlayers.length}</span>
                </div>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {/* ── FP Toast ─────────────────────────────────────────────────────── */}
      {fpToast && (
        <div className="absolute left-1/2 transform -translate-x-1/2 z-30" style={{ top: 'calc(5rem + env(safe-area-inset-top))' }}>
          <div className="bg-yellow-500 text-black font-bold px-4 py-2 rounded-full text-sm shadow-lg">
            {fpToast}
          </div>
        </div>
      )}

      {/* ── PvP Toast (declined / error) ─────────────────────────────────── */}
      {pvpToast && (
        <div className="absolute left-1/2 transform -translate-x-1/2 z-30 w-max max-w-xs" style={{ top: 'calc(5rem + env(safe-area-inset-top))' }}>
          <div className="bg-gray-800 border border-gray-600 text-white px-4 py-2 rounded-full text-sm shadow-lg text-center">
            {pvpToast}
          </div>
        </div>
      )}

      {/* ── Waiting for challenger response ──────────────────────────────── */}
      {sentChallenge && (
        <div className="absolute left-1/2 transform -translate-x-1/2 z-30 w-max" style={{ top: 'calc(5rem + env(safe-area-inset-top))' }}>
          <div className="bg-purple-900/90 border border-purple-500/50 text-white px-4 py-2 rounded-full text-sm shadow-lg flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            Waiting for {sentChallenge.opponentName}...
          </div>
        </div>
      )}

      {/* ── Your own dot's bottom sheet ───────────────────────────────────── */}
      {selfSheet && (
        <div className="absolute bottom-20 left-4 right-4 z-30 bg-gray-900 rounded-2xl p-4 border border-gray-700 shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-14 h-14 rounded-2xl object-cover border-2"
                style={{ borderColor: partyColor }} />
            ) : (
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl border-2"
                style={{ borderColor: partyColor, background: `${partyColor}33` }}>
                {profile?.party === 'democrat' ? '🔵' : '🔴'}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-white font-bold text-lg truncate">{profile?.username}</span>
                {homeHall && (
                  <button onClick={() => router.push(`/townhall/${homeHall.id}`)}
                    className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-black text-purple-300 bg-purple-950/60 border border-purple-800 hover:text-white transition">
                    🏛️ {homeHall.city_name}, {homeHall.state}
                  </button>
                )}
              </div>
              <div className="text-gray-400 text-xs">That's you! 📍</div>
              <div className={`text-[11px] mt-0.5 ${(profile as any)?.location_fuzz ? 'text-yellow-500/90' : 'text-green-500/90'}`}>
                {(profile as any)?.location_fuzz ? '≈ Others see this approximate spot' : '📍 Others see your exact location'}
              </div>
            </div>
            <button onClick={() => setSelfSheet(false)} className="ml-auto self-start text-gray-500 hover:text-white text-xl leading-none">✕</button>
          </div>
          <div className="space-y-2">
            {/* One color family for every menu button (Michael): purple */}
            {/* one visual button: profile on the left, share icon fused on the right */}
            <div className="flex rounded-xl overflow-hidden border border-purple-800"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              <button
                onClick={() => router.push('/profile')}
                className="flex-1 py-3 font-bold text-white transition active:bg-black/20">
                👤 My Profile
              </button>
              <div className="w-px my-2 bg-white/25" />
              {/* native share sheet (apps / copy / airdrop…); clipboard fallback */}
              <button
                aria-label="Share my profile"
                onClick={async () => {
                  const url = `${window.location.origin}/player/${profile?.id}`
                  const data = { title: 'PoliticsGo', text: `⚔️ Check out my PoliticsGo profile — ${profile?.username}`, url }
                  try {
                    if (navigator.share) await navigator.share(data)
                    else { await navigator.clipboard.writeText(url); showPvpToast('🔗 Profile link copied!') }
                  } catch { /* user closed the share sheet */ }
                }}
                className="px-5 py-3 text-white text-lg transition active:bg-black/20">
                📤
              </button>
            </div>
            {/* Arena — fused share, mirrors the profile row */}
            <div className="flex rounded-xl overflow-hidden border border-purple-800"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              <button
                onClick={() => router.push('/arena')}
                className="flex-1 py-3 font-bold text-white transition active:bg-black/20">
                🏟️ Arena
              </button>
              <div className="w-px my-2 bg-white/25" />
              <button
                aria-label="Share a fight-me link"
                onClick={async () => {
                  // public fight-me page: ANYONE who clicks it (even non-users,
                  // via a quick sign-up) lands in a live PvP against me — I get
                  // the "called you out" push and join from the notification
                  const url = `${window.location.origin}/fight/${profile?.id}`
                  const data = { title: 'PoliticsGo', text: `⚔️ Think you can beat me in a street fight? Prove it.`, url }
                  try {
                    if (navigator.share) await navigator.share(data)
                    else { await navigator.clipboard.writeText(url); showPvpToast('🔗 Fight-me link copied!') }
                  } catch { /* user closed the share sheet */ }
                }}
                className="px-5 py-3 text-white text-lg transition active:bg-black/20">
                📤
              </button>
            </div>
            {/* the battlemap home page — the game's "home button" */}
            <button
              onClick={() => router.push('/')}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 border border-purple-800"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              🗺️ Battle Map
            </button>
          </div>
        </div>
      )}

      {/* ── Selected player bottom sheet ──────────────────────────────────── */}
      {selectedPlayer && !sentChallenge && !selfSheet && (
        <div className="absolute bottom-20 left-4 right-4 z-30 bg-gray-900 rounded-2xl p-4 border border-gray-700 shadow-2xl">
          {/* Player header — big tappable photo opens their album */}
          <div className="flex items-center gap-3 mb-4">
            {selectedPlayer.avatar_url ? (
              <button onClick={() => openPlayerAlbum(selectedPlayer)}
                className="relative flex-shrink-0 active:scale-95 transition">
                <img src={selectedPlayer.avatar_url} alt={selectedPlayer.username}
                  className="w-24 h-24 rounded-2xl object-cover border-2"
                  style={{
                    borderColor: selectedPlayer.party === 'democrat' ? '#3b82f6'
                      : selectedPlayer.party === 'republican' ? '#ef4444' : '#e5e7eb',
                  }} />
                <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  🔍 View
                </span>
              </button>
            ) : (
              <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-4xl flex-shrink-0"
                style={{
                  background: selectedPlayer.party === 'democrat' ? '#1e3a8a'
                    : selectedPlayer.party === 'republican' ? '#7f1d1d' : '#1f2937',
                  border: `2px solid ${selectedPlayer.party === 'democrat' ? '#3b82f6'
                    : selectedPlayer.party === 'republican' ? '#ef4444' : '#6b7280'}`,
                }}>
                {selectedPlayer.party === 'democrat' ? '🔵' : selectedPlayer.party === 'republican' ? '🔴' : '⚪'}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-white font-bold text-lg truncate">{selectedPlayer.username}</div>
              <div className="text-gray-400 text-xs">
                {selectedPlayer.party ? selectedPlayer.party.charAt(0).toUpperCase() + selectedPlayer.party.slice(1) : 'Affiliation hidden'}
              </div>
              <div className={`text-[11px] mt-0.5 ${selectedPlayer.approx ? 'text-yellow-500/90' : 'text-green-500/90'}`}>
                {selectedPlayer.approx ? '≈ Approximate location (~1 mi)' : '📍 Exact location'}
              </div>
            </div>
            <button onClick={() => setSelectedPlayer(null)} className="ml-auto self-start text-gray-500 hover:text-white text-xl leading-none">✕</button>
          </div>

          <div className="space-y-2">
            {/* One color family for every menu button (Michael): purple */}
            <button
              onClick={() => router.push(`/player/${selectedPlayer.profile_id}`)}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 border border-purple-800"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
            >
              👤 View Profile
            </button>
            {/* Battle — anyone can challenge anyone (same party or rival) */}
            {profile && (
              <button
                onClick={() => sendChallenge(selectedPlayer)}
                disabled={challengeLoading || profile.fp_balance < 50}
                className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50 border border-purple-800"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
              >
                {challengeLoading ? '⏳ Sending...' : '⚔️ Challenge to Battle (free)'}
              </button>
            )}

            {/* Direct Message — anyone you can see, you can message */}
            <button
              onClick={() => startChat(selectedPlayer)}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 border border-purple-800"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
            >
              💬 Direct Message
            </button>

            {/* Block — same purple family, quiet outline (red only on hover) */}
            <button
              onClick={() => blockPlayer(selectedPlayer.profile_id, selectedPlayer.username)}
              className="w-full py-2 rounded-xl text-purple-300/80 hover:text-red-400 text-sm transition bg-purple-950/40 border border-purple-800 hover:border-red-900"
            >
              🚫 Block {selectedPlayer.username}
            </button>
          </div>

          {profile && profile.fp_balance < 50 && (
            <p className="text-red-400 text-xs text-center mt-2">Need 50 FP to battle</p>
          )}
        </div>
      )}

      {/* ── Incoming message popup ────────────────────────────────────────── */}
      {incomingMsg && !activeChatUserId && (
        <div className="absolute bottom-20 left-4 right-4 z-40">
          <div className="bg-gray-900 rounded-2xl p-4 border border-blue-700/60 shadow-2xl max-w-md mx-auto">
            <div className="flex items-center gap-3 mb-3">
              {incomingMsg.sender_avatar
                ? <img src={incomingMsg.sender_avatar} alt="" className="w-10 h-10 rounded-full object-cover border border-blue-700 flex-shrink-0" />
                : <div className="w-10 h-10 rounded-full bg-blue-900/50 flex items-center justify-center flex-shrink-0">💬</div>}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {/* name → profile */}
                  <button onClick={() => router.push(`/player/${incomingMsg.sender_id}`)}
                    className="text-white text-sm font-bold truncate hover:underline">{incomingMsg.sender_username}</button>
                  {/* distance → their spot on the map */}
                  {(() => {
                    const spot = playerSpot(incomingMsg.sender_id)
                    if (!spot || spot.dist == null) return null
                    return (
                      <button onClick={() => { setIncomingMsg(null); focusSpot(spot.lat, spot.lng) }}
                        className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex-shrink-0">
                        📍 {spot.dist < 0.1 ? 'here' : `${spot.dist.toFixed(1)} mi`}
                      </button>
                    )
                  })()}
                </div>
                <p className="text-gray-400 text-xs truncate">{incomingMsg.preview}</p>
              </div>
              {/* Dismiss — closes the bubble without snoozing or blocking */}
              <button onClick={() => setIncomingMsg(null)}
                className="text-gray-500 hover:text-white text-lg leading-none px-1 flex-shrink-0" aria-label="Dismiss">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={replyToMsg}
                className="py-2.5 bg-blue-700 hover:bg-blue-600 text-white rounded-xl font-bold text-sm transition">
                💬 Reply
              </button>
              <button onClick={snoozeMsg}
                className="py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-bold text-sm transition">
                😴 Snooze
              </button>
              <button onClick={blockMsgSender}
                className="py-2.5 bg-gray-800 hover:bg-red-900/60 text-gray-400 hover:text-red-300 rounded-xl font-bold text-sm transition">
                🚫 Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo album lightbox ──────────────────────────────────────────── */}
      {album && (
        <AlbumViewer photos={album.photos} title={album.title} onClose={() => setAlbum(null)} />
      )}

      {/* ── Active chat overlay ───────────────────────────────────────────── */}
      {activeChatUserId && (
        <div className="absolute bottom-20 left-0 right-0 z-30 px-4">
          <div className="bg-gray-900 rounded-2xl border border-blue-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                {/* name → profile */}
                <button onClick={() => router.push(`/player/${activeChatUserId}`)}
                  className="text-white text-sm font-bold truncate hover:underline">{activeChatUsername}</button>
                {/* distance → their spot on the map */}
                {(() => {
                  const spot = playerSpot(activeChatUserId)
                  if (!spot || spot.dist == null) return null
                  return (
                    <button onClick={() => focusSpot(spot.lat, spot.lng)}
                      className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-0.5 flex-shrink-0">
                      📍 {spot.dist < 0.1 ? 'here' : `${spot.dist.toFixed(1)} mi`}
                    </button>
                  )
                })()}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => blockPlayer(activeChatUserId, activeChatUsername)}
                  className="text-gray-600 hover:text-red-400 text-xs transition px-2 py-1">
                  🚫 Block
                </button>
                <button onClick={() => { setActiveChatUserId(null); setActiveChatUsername(''); setChatMessages([]) }}
                  className="text-gray-500 hover:text-white text-lg leading-none px-1">
                  ✕
                </button>
              </div>
            </div>
            <div ref={chatBoxRef} className="max-h-44 overflow-y-auto p-3 space-y-2">
              {chatMessages.length === 0 ? (
                <p className="text-gray-600 text-xs text-center py-2">Say something...</p>
              ) : chatMessages.map(msg => {
                const isMe = msg.sender_id === profile?.id
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[75%] rounded-xl text-sm text-white overflow-hidden"
                      style={{
                        background: isMe ? '#1d4ed8' : '#1f2937',
                        borderBottomRightRadius: isMe ? 4 : undefined,
                        borderBottomLeftRadius: isMe ? undefined : 4,
                      }}>
                      {msg.image_url && <img src={msg.image_url} alt="" className="w-full max-h-48 object-cover" />}
                      {msg.content && <div className="px-3 py-1.5">{msg.content}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2 p-3 border-t border-gray-800">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                placeholder="Type a message..."
                maxLength={500}
                className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-600 border border-transparent focus:border-blue-700 transition"
              />
              <button onClick={sendChatMessage}
                disabled={chatSending || !chatInput.trim()}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded-xl font-bold transition">
                Send
              </button>
            </div>
          </div>
        </div>
      )}

<style>{`
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
        /* zoom stack (Michael): bigger 40px targets, LOWER RIGHT — riding
           just above the bottom nav, aligned to the app column's edge */
        .mapboxgl-ctrl-bottom-right {
          bottom: calc(5rem + env(safe-area-inset-bottom));
          right: calc(max(0px, (100vw - 28rem) / 2) + 12px);
        }
        .mapboxgl-ctrl-bottom-right .mapboxgl-ctrl { margin: 0 !important; }
        .mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-group button {
          width: 40px !important;
          height: 40px !important;
        }
      `}</style>
    </div>
  )
}

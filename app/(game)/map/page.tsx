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
  const [spawnedEnemies, setSpawnedEnemies] = useState<SpawnedEnemy[]>([])
  const [spawnTick, setSpawnTick] = useState(0)

  // Re-evaluate spawns every 5 min: respawns come back and the 90-min
  // rotation kicks in even if the player never moves
  useEffect(() => {
    const iv = setInterval(() => setSpawnTick(t => t + 1), 5 * 60_000)
    return () => clearInterval(iv)
  }, [])
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
  const [incomingChallenge, setIncomingChallenge] = useState<IncomingChallenge | null>(null)
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
    // (full size only at z15+, down to ~30% at z11)
    const scale = Math.max(0.3, Math.min(1, 0.3 + (z - 11) * 0.175))
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

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    // Home button under the zoom/compass stack — fly back to where you are
    const homeControl = {
      onAdd() {
        const div = document.createElement('div')
        div.className = 'mapboxgl-ctrl mapboxgl-ctrl-group'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.title = 'Go to my location'
        btn.style.fontSize = '17px'
        btn.textContent = '📍'
        btn.addEventListener('click', () => {
          const l = displayedLocRef.current ?? locationRef.current
          if (l && map.current) map.current.flyTo({ center: [l.lng, l.lat], zoom: 16, pitch: 30 })
        })
        div.appendChild(btn)
        return div
      },
      onRemove() {},
    }
    map.current.addControl(homeControl as unknown as mapboxgl.IControl, 'top-right')

    map.current.on('zoom', applyZoomVisibility)

    return () => {
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

    fetchAndRender()
    const interval = setInterval(fetchAndRender, 8000)
    return () => {
      clearInterval(interval)
      otherPlayerMarkersRef.current.forEach(m => m.remove())
      otherPlayerMarkersRef.current = new Map()
    }
  }, [hasLocation, mapPrefs.dems, mapPrefs.reps])

  // ── Poll for incoming PvP challenges every 5s ─────────────────────────────
  useEffect(() => {
    if (!hasLocation || incomingChallenge || sentChallenge) return

    const check = async () => {
      try {
        const res = await fetch('/api/pvp/pending')
        const data = await res.json()
        if (data.challenge) setIncomingChallenge(data.challenge)
      } catch {}
    }

    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [hasLocation, incomingChallenge, sentChallenge])

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

  // ── Respond to incoming challenge ─────────────────────────────────────────
  async function respondToChallenge(accept: boolean) {
    if (!incomingChallenge || !profile) return
    const challenge = incomingChallenge
    setIncomingChallenge(null)

    if (!accept) {
      fetch(`/api/pvp/${challenge.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept: false }),
      }).catch(() => {})
      return
    }

    try {
      const res = await fetch(`/api/pvp/${challenge.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept: true }),
      })
      const data = await res.json()

      if (res.ok && (data.status === 'accepted' || data.status === 'completed')) {
        // Accepting arms the fight — the challenger plays it; watch for the result
        router.push(`/battle/pvp?id=${challenge.id}`)
      } else {
        showPvpToast(`❌ ${data.error || 'Battle failed'}`)
      }
    } catch {
      showPvpToast('❌ Could not complete battle')
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
  useEffect(() => {
    if (!gridLat || !gridLng) return
    const loc = locationRef.current
    if (!loc) return
    fetch(`/api/gyms?lat=${loc.lat}&lng=${loc.lng}`)
      .then(r => r.json())
      .then(data => setGyms(data.gyms || []))
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
              width:72px;height:auto;pointer-events:none;
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
    const loc = locationRef.current
    if (!loc) return

    // Seeded random so enemies stay in the same spots per grid cell
    function seededRand(seed: string): number {
      let h = 0
      for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
      return Math.abs(h) / 2147483647
    }

    const RESPAWN_MS = 5 * 60 * 1000

    function isAlive(spawnId: string): boolean {
      try {
        const t = localStorage.getItem(`spawn_dead_${spawnId}`)
        return !t || Date.now() - parseInt(t) > RESPAWN_MS
      } catch { return true }
    }

    const enemies: SpawnedEnemy[] = []

    // Opponents are always the OPPOSING party
    const opponentParty = profile.party === 'republican' ? 'democrat' : 'republican'

    // Spawns rotate every 90 minutes: the bucket is part of every seed, so
    // enemies hold their positions long enough to walk to, then the whole
    // board reshuffles into fresh random spots.
    const bucket = Math.floor(Date.now() / 5_400_000)

    // CLOSE RING: 3 enemies within ~0.2-0.9 mi — these are attackable now
    // (or after a short walk). Seeded by grid cell so GPS jitter doesn't
    // teleport them.
    for (let i = 0; i < 3; i++) {
      const spawnId = `local_${i}_${bucket}`
      if (!isAlive(spawnId)) continue
      const seed = `${spawnId}_${gridLat}_${gridLng}`
      const angle = seededRand(seed + 'a') * Math.PI * 2
      const distMiles = 0.2 + seededRand(seed + 'd') * 0.7
      enemies.push({
        id: spawnId,
        enemy: getRandomEnemy(opponentParty),
        lat: loc.lat + Math.sin(angle) * (distMiles / 69),
        lng: loc.lng + Math.cos(angle) * (distMiles / (69 * Math.cos(loc.lat * Math.PI / 180))),
      })
    }

    // WALK-TO RING: 5 enemies scattered 1.2-4.5 mi out in random directions —
    // visible on the map as targets worth walking toward
    for (let i = 0; i < 5; i++) {
      const spawnId = `ring_${i}_${bucket}`
      if (!isAlive(spawnId)) continue
      const seed = `${spawnId}_${gridLat}_${gridLng}`
      const angle = seededRand(seed + 'a') * Math.PI * 2
      const distMiles = 1.2 + seededRand(seed + 'd') * 3.3
      enemies.push({
        id: spawnId,
        enemy: getRandomEnemy(opponentParty),
        lat: loc.lat + Math.sin(angle) * (distMiles / 69),
        lng: loc.lng + Math.cos(angle) * (distMiles / (69 * Math.cos(loc.lat * Math.PI / 180))),
      })
    }

    // 2-4 enemies seeded inside each NEARBY gym circle. Gyms come back from
    // /api/gyms up to 100 miles out — only consider gyms whose zone could
    // put an enemy within the 5-mile visibility range.
    gyms
      .filter(gym => {
        const d = parseFloat(gym.distance_miles)
        const zr = gym.radius_miles || DEFAULT_RADIUS_MILES
        return Number.isFinite(d) && d <= 5 + zr
      })
      .forEach(gym => {
        const count = 2 + Math.floor(seededRand(gym.id + 'n' + bucket) * 3)
        for (let i = 0; i < count; i++) {
          const spawnId = `gym_${gym.id}_${i}_${bucket}`
          if (!isAlive(spawnId)) continue
          const seed = gym.id + i + bucket
          const angle = seededRand(seed + 'a') * Math.PI * 2
          // Spawn inside this gym's own zone, whatever its radius
          const zoneRadius = gym.radius_miles || DEFAULT_RADIUS_MILES
          const radiusMiles = 0.5 + seededRand(seed + 'r') * Math.max(1, zoneRadius - 1)
          const radiusLat = radiusMiles / 69.0
          const radiusLng = radiusMiles / (69.0 * Math.cos(gym.latitude * Math.PI / 180))
          enemies.push({
            id: spawnId,
            enemy: getRandomEnemy(opponentParty),
            lat: gym.latitude + Math.sin(angle) * radiusLat,
            lng: gym.longitude + Math.cos(angle) * radiusLng,
          })
        }
      })

    // Visibility: enemies within 5 miles are shown; battle range is 1 mile
    const visible = enemies.filter(e => milesBetween(loc.lat, loc.lng, e.lat, e.lng) <= 5)

    setSpawnedEnemies(visible)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridLat, gridLng, profile, gyms, spawnTick])

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
    <div className="relative overflow-hidden" style={{ height: 'calc(100dvh - 5rem)' }}>
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* ── HUD: Top Left ───────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <div className="bg-black/75 backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: partyColor }} />
          <span className="text-white text-xs font-semibold">
            {profile?.party === 'democrat' ? 'Democrats' : 'Republicans'}
          </span>
          <div className="w-px h-3 bg-gray-600" />
          <span className="text-yellow-400 text-xs font-bold">⚡ {profile?.fp_balance?.toLocaleString() || 0}</span>
        </div>
        <div className="bg-black/75 backdrop-blur rounded-xl px-3 py-2">
          <span className="text-white text-xs">👟 {steps.toLocaleString()} steps</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowMapMenu(v => !v)}
            className={`backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2 transition-all ${
              showMapMenu ? 'bg-blue-900/80 border border-blue-500/60' : 'bg-black/75 border border-transparent'
            }`}
          >
            <span className="text-xs">🗺️</span>
            <span className="text-white text-xs font-medium">Show on map</span>
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

      {/* ── Bottom info bar ──────────────────────────────────────────────── */}
      <div className="absolute bottom-6 left-0 right-0 z-20 flex justify-center px-4">
        <div className="bg-black/75 backdrop-blur rounded-full px-5 py-2.5 flex items-center gap-3">
          <span className="text-white text-xs">{spawnedEnemies.length} enemies nearby</span>
          <div className="w-px h-3 bg-gray-600" />
          <span className="text-white text-xs">{gyms.length} town halls</span>
          {nearbyPlayers.length > 0 && (
            <>
              <div className="w-px h-3 bg-gray-600" />
              <span className="text-blue-300 text-xs">{nearbyPlayers.length} player{nearbyPlayers.length !== 1 ? 's' : ''} nearby</span>
            </>
          )}
        </div>
      </div>

      {/* ── FP Toast ─────────────────────────────────────────────────────── */}
      {fpToast && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-30">
          <div className="bg-yellow-500 text-black font-bold px-4 py-2 rounded-full text-sm shadow-lg">
            {fpToast}
          </div>
        </div>
      )}

      {/* ── PvP Toast (declined / error) ─────────────────────────────────── */}
      {pvpToast && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-30 w-max max-w-xs">
          <div className="bg-gray-800 border border-gray-600 text-white px-4 py-2 rounded-full text-sm shadow-lg text-center">
            {pvpToast}
          </div>
        </div>
      )}

      {/* ── Waiting for challenger response ──────────────────────────────── */}
      {sentChallenge && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-30 w-max">
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
              <div className="text-white font-bold text-lg truncate">{profile?.username}</div>
              <div className="text-gray-400 text-xs">That's you! 📍</div>
              <div className={`text-[11px] mt-0.5 ${(profile as any)?.location_fuzz ? 'text-yellow-500/90' : 'text-green-500/90'}`}>
                {(profile as any)?.location_fuzz ? '≈ Others see this approximate spot' : '📍 Others see your exact location'}
              </div>
            </div>
            <button onClick={() => setSelfSheet(false)} className="ml-auto self-start text-gray-500 hover:text-white text-xl leading-none">✕</button>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => router.push('/profile')}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 bg-gray-800 hover:bg-gray-700 border border-gray-700">
              👤 My Profile
            </button>
            <button
              onClick={() => router.push('/messages')}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 bg-blue-900 hover:bg-blue-800 border border-blue-700">
              💬 My Messages
            </button>
            <button
              onClick={() => {
                const nearest = [...gyms].sort((a, b) => parseFloat(a.distance_miles) - parseFloat(b.distance_miles))[0]
                if (nearest) router.push(`/townhall/${nearest.id}`)
                else showPvpToast('🏛️ No town halls in range yet')
              }}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95"
              style={{ background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)` }}>
              🏛️ Local Town Hall
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
            {/* View profile — public page with posts + click */}
            <button
              onClick={() => router.push(`/player/${selectedPlayer.profile_id}`)}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 bg-gray-800 hover:bg-gray-700 border border-gray-700"
            >
              👤 View Profile
            </button>
            {/* Battle — only if both parties are visible and different */}
            {selectedPlayer.party && profile?.party && selectedPlayer.party !== profile.party && (
              <button
                onClick={() => sendChallenge(selectedPlayer)}
                disabled={challengeLoading || !profile || profile.fp_balance < 50}
                className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
              >
                {challengeLoading ? '⏳ Sending...' : '⚔️ Challenge to Battle (free)'}
              </button>
            )}

            {/* Direct Message — anyone you can see, you can message */}
            <button
              onClick={() => startChat(selectedPlayer)}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 bg-blue-900 hover:bg-blue-800 border border-blue-700"
            >
              💬 Direct Message
            </button>

            {/* Block */}
            <button
              onClick={() => blockPlayer(selectedPlayer.profile_id, selectedPlayer.username)}
              className="w-full py-2 rounded-xl text-gray-500 hover:text-red-400 text-sm transition border border-gray-800 hover:border-red-900"
            >
              🚫 Block {selectedPlayer.username}
            </button>
          </div>

          {profile && selectedPlayer.party && selectedPlayer.party !== profile.party && profile.fp_balance < 50 && (
            <p className="text-red-400 text-xs text-center mt-2">Need 50 FP to battle</p>
          )}
        </div>
      )}

      {/* ── Incoming challenge modal ──────────────────────────────────────── */}
      {incomingChallenge && (
        <div className="absolute inset-0 z-40 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-gray-900 rounded-2xl p-6 border border-purple-500/50 shadow-2xl w-full max-w-sm">
            <div className="text-center mb-5">
              <div className="text-6xl mb-3">⚔️</div>
              <h2 className="text-white font-black text-xl">You're Challenged!</h2>
              <p className="text-gray-400 text-sm mt-2">
                <span className={`font-bold ${incomingChallenge.challenger_party === 'democrat' ? 'text-blue-400' : 'text-red-400'}`}>
                  {incomingChallenge.challenger_username}
                </span>{' '}
                wants to battle you
              </p>
              <div className="mt-4 bg-purple-900/40 rounded-xl p-3 border border-purple-700">
                <p className="text-purple-300 font-black text-xl">⚡ {incomingChallenge.fp_stake} FP</p>
                <p className="text-gray-500 text-xs mt-1">at stake — winner takes all</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => respondToChallenge(false)}
                className="py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-bold transition"
              >
                Decline
              </button>
              <button
                onClick={() => respondToChallenge(true)}
                disabled={(profile?.fp_balance || 0) < incomingChallenge.fp_stake}
                className="py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
              >
                ⚔️ Accept!
              </button>
            </div>
            {profile && profile.fp_balance < incomingChallenge.fp_stake && (
              <p className="text-red-400 text-xs text-center mt-2">Insufficient FP to accept</p>
            )}
          </div>
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
                <p className="text-white text-sm font-bold truncate">{incomingMsg.sender_username}</p>
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
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-white text-sm font-bold">{activeChatUsername}</span>
              </div>
              <div className="flex items-center gap-2">
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
      `}</style>
    </div>
  )
}

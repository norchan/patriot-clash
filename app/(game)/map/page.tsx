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

const CHALLENGE_RADIUS_MILES = 15

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
}

interface NearbyPlayer {
  profile_id: string
  username: string
  party: 'democrat' | 'republican' | null  // null = hidden affiliation
  lat: number
  lng: number
  allow_messages: boolean
}

interface IncomingChatReq {
  id: string
  sender_id: string
  sender_username: string
  sender_party: 'democrat' | 'republican' | null
  expires_at: string
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
  const [nearbyPlayers, setNearbyPlayers] = useState<NearbyPlayer[]>([])
  const [showPlayers, setShowPlayers] = useState(true)
  const [fpToast, setFpToast] = useState('')

  // PvP / player interaction state
  const [selectedPlayer, setSelectedPlayer] = useState<NearbyPlayer | null>(null)
  const [incomingChallenge, setIncomingChallenge] = useState<IncomingChallenge | null>(null)
  const [sentChallenge, setSentChallenge] = useState<{ id: string; opponentName: string } | null>(null)
  const [challengeLoading, setChallengeLoading] = useState(false)
  const [pvpToast, setPvpToast] = useState('')

  // Chat state
  const [incomingChatReq, setIncomingChatReq] = useState<IncomingChatReq | null>(null)
  const [activeChatUserId, setActiveChatUserId] = useState<string | null>(null)
  const [activeChatUsername, setActiveChatUsername] = useState('')
  const [chatMessages, setChatMessages] = useState<{ id: string; sender_id: string; content: string; created_at: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const chatBoxRef = useRef<HTMLDivElement>(null)

  // Map refs
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const playerMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const otherPlayerMarkersRef = useRef<mapboxgl.Marker[]>([])
  const mapInitialized = useRef(false)

  function showPvpToast(msg: string) {
    setPvpToast(msg)
    setTimeout(() => setPvpToast(''), 4000)
  }

  // Load player toggle preference
  useEffect(() => {
    const saved = localStorage.getItem('show_players')
    if (saved !== null) setShowPlayers(saved === 'true')
  }, [])

  function togglePlayers() {
    const next = !showPlayers
    setShowPlayers(next)
    localStorage.setItem('show_players', String(next))
    if (!next) {
      otherPlayerMarkersRef.current.forEach(m => m.remove())
      otherPlayerMarkersRef.current = []
      setNearbyPlayers([])
    }
  }

  // ── Map initialization ────────────────────────────────────────────────────
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

  // ── Own player marker ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || !location) return

    if (playerMarkerRef.current) {
      playerMarkerRef.current.setLngLat([location.lng, location.lat])
    } else {
      const color = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
      const el = document.createElement('div')
      el.style.cssText = `
        width: 20px; height: 20px;
        background: ${color}; border: 3px solid white; border-radius: 50%;
        box-shadow: 0 0 0 3px ${color}, 0 0 15px ${color}88;
        cursor: pointer;
      `
      playerMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([location.lng, location.lat])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(`📍 ${profile?.username || 'You'}`))
        .addTo(map.current!)
    }
  }, [location, profile])

  // ── Broadcast own location every 10s ──────────────────────────────────────
  useEffect(() => {
    if (!location) return
    const broadcast = () => {
      fetch('/api/players/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: location.lat, lng: location.lng }),
      }).catch(() => {})
    }
    broadcast()
    const interval = setInterval(broadcast, 10000)
    return () => clearInterval(interval)
  }, [location])

  // ── Fetch & render nearby players every 8s ────────────────────────────────
  useEffect(() => {
    if (!location || !showPlayers) return

    const fetchAndRender = async () => {
      if (!map.current) return
      try {
        const res = await fetch(`/api/players/nearby?lat=${location.lat}&lng=${location.lng}`)
        const data = await res.json()
        const players: NearbyPlayer[] = data.players ?? []
        setNearbyPlayers(players)

        otherPlayerMarkersRef.current.forEach(m => m.remove())
        otherPlayerMarkersRef.current = []

        if (!map.current) return

        players.forEach(player => {
          // White/neutral if party is hidden, otherwise party color
          const color = player.party === 'democrat' ? '#2563eb'
            : player.party === 'republican' ? '#dc2626'
            : '#9ca3af'
          const dotEmoji = player.party === 'democrat' ? '🔵'
            : player.party === 'republican' ? '🔴' : '⚪'
          const el = document.createElement('div')
          el.style.cursor = 'pointer'
          el.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
              <div style="
                width:16px;height:16px;border-radius:50%;
                background:${color};border:2px solid white;
                box-shadow:0 0 0 2px ${color},0 0 8px ${color}66;
              "></div>
              <div style="
                background:rgba(0,0,0,0.85);color:white;
                font-size:10px;font-weight:600;padding:2px 5px;
                border-radius:4px;white-space:nowrap;
                border:1px solid ${color}66;
              ">${dotEmoji} ${player.username || 'Player'}</div>
            </div>
          `
          el.addEventListener('click', () => setSelectedPlayer(player))

          const marker = new mapboxgl.Marker({ element: el, anchor: 'top' })
            .setLngLat([player.lng, player.lat])
            .addTo(map.current!)
          otherPlayerMarkersRef.current.push(marker)
        })
      } catch {
        // Player markers are non-critical — silently ignore
      }
    }

    fetchAndRender()
    const interval = setInterval(fetchAndRender, 8000)
    return () => {
      clearInterval(interval)
      otherPlayerMarkersRef.current.forEach(m => m.remove())
      otherPlayerMarkersRef.current = []
    }
  }, [location, showPlayers])

  // ── Poll for incoming PvP challenges every 5s ─────────────────────────────
  useEffect(() => {
    if (!location || incomingChallenge || sentChallenge) return

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
  }, [location, incomingChallenge, sentChallenge])

  // ── Poll sent challenge for result every 3s ───────────────────────────────
  useEffect(() => {
    if (!sentChallenge || !profile) return

    const poll = async () => {
      try {
        const res = await fetch(`/api/pvp/${sentChallenge.id}`)
        const data = await res.json()

        if (data.status === 'completed') {
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
      if (res.ok) {
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

      if (res.ok && data.status === 'completed') {
        router.push(`/battle/pvp?id=${challenge.id}`)
      } else {
        showPvpToast(`❌ ${data.error || 'Battle failed'}`)
      }
    } catch {
      showPvpToast('❌ Could not complete battle')
    }
  }

  // ── Poll for incoming chat requests every 5s ─────────────────────────────
  useEffect(() => {
    if (!location || incomingChallenge || incomingChatReq || activeChatUserId) return
    const check = async () => {
      try {
        const res = await fetch('/api/chat/pending')
        const data = await res.json()
        if (data.request) setIncomingChatReq(data.request)
      } catch {}
    }
    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [location, incomingChallenge, incomingChatReq, activeChatUserId])

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

  // ── Start a chat with a player ────────────────────────────────────────────
  async function startChat(player: NearbyPlayer) {
    setSelectedPlayer(null)
    try {
      const res = await fetch('/api/chat/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver_id: player.profile_id }),
      })
      const data = await res.json()
      if (res.ok) {
        showPvpToast(`💬 Chat request sent to ${player.username}`)
      } else {
        showPvpToast(`❌ ${data.error || 'Could not send request'}`)
      }
    } catch {
      showPvpToast('❌ Could not send chat request')
    }
  }

  // ── Accept / decline incoming chat request ────────────────────────────────
  async function respondToChatReq(accept: boolean) {
    if (!incomingChatReq) return
    const req = incomingChatReq
    setIncomingChatReq(null)
    try {
      const res = await fetch(`/api/chat/request/${req.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept }),
      })
      if (res.ok && accept) {
        setActiveChatUserId(req.sender_id)
        setActiveChatUsername(req.sender_username)
        setChatMessages([])
      }
    } catch {}
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

  // ── Gyms ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!location) return
    fetch(`/api/gyms?lat=${location.lat}&lng=${location.lng}`)
      .then(r => r.json())
      .then(data => setGyms(data.gyms || []))
      .catch(console.error)
  }, [location])

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
            coordinates: [makeCircleCoords(gym.longitude, gym.latitude, CHALLENGE_RADIUS_MILES)],
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

      // ── Gym label markers (HTML, always above vector layers) ────────────────
      gyms.forEach(gym => {
        const partyColor = gym.holder_party === 'democrat' ? '#2563eb'
          : gym.holder_party === 'republican' ? '#dc2626' : '#6b7280'
        const flagEmoji = gym.holder_party === 'democrat' ? '🔵'
          : gym.holder_party === 'republican' ? '🔴' : '⚪'
        const el = document.createElement('div')
        el.innerHTML = `
          <div style="
            background:rgba(0,0,0,0.85);border:2px solid ${partyColor};
            border-radius:10px;padding:4px 8px;display:flex;
            align-items:center;gap:4px;cursor:pointer;
            white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.4);
          ">
            <span style="font-size:14px;">🏛️</span>
            <span style="color:white;font-size:11px;font-weight:600;">${gym.city_name}</span>
            <span style="font-size:10px;">${flagEmoji}</span>
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
      map.current.once('load', addGyms)
    }
  }, [gyms, router])

  // ── Enemy spawns ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!location || !profile) return

    // Seeded random so gym enemies stay in the same spots per session
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

    // 2 random enemies near the player
    for (let i = 0; i < 2; i++) {
      const spawnId = `local_${i}`
      if (!isAlive(spawnId)) continue
      const angle = Math.random() * Math.PI * 2
      const dist = 0.001 + Math.random() * 0.002
      enemies.push({
        id: spawnId,
        enemy: getRandomEnemy(opponentParty),
        lat: location.lat + Math.sin(angle) * dist,
        lng: location.lng + Math.cos(angle) * dist,
      })
    }

    // 1-2 enemies seeded inside each gym circle
    gyms.forEach(gym => {
      const count = 1 + Math.floor(seededRand(gym.id + 'n') * 2)
      for (let i = 0; i < count; i++) {
        const spawnId = `gym_${gym.id}_${i}`
        if (!isAlive(spawnId)) continue
        const seed = gym.id + i
        const angle = seededRand(seed + 'a') * Math.PI * 2
        const radiusMiles = 1 + seededRand(seed + 'r') * 11
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

    setSpawnedEnemies(enemies)
  }, [location?.lat, location?.lng, profile, gyms])

  useEffect(() => {
    if (!map.current || spawnedEnemies.length === 0) return

    const addEnemies = () => {
      // Inject marker animation styles once
      if (!document.getElementById('enemy-marker-styles')) {
        const s = document.createElement('style')
        s.id = 'enemy-marker-styles'
        s.textContent = `
          .em-wrap { display:flex; flex-direction:column; align-items:center; cursor:pointer; position:relative; animation:emBob 2.6s ease-in-out infinite; }
          .em-pulse { position:absolute; border-radius:50%; animation:emPulse 2s ease-out infinite; pointer-events:none; }
          .em-pulse.legendary { border-radius:18px; }
          .em-img  { border-radius:50%; overflow:hidden; position:relative; z-index:1; }
          .em-img.legendary { border-radius:14px; }
          .em-name { font-size:10px; font-weight:700; color:white; background:rgba(0,0,0,0.82); padding:2px 6px; border-radius:5px; margin-top:4px; white-space:nowrap; border:1px solid rgba(255,255,255,0.12); }
          .em-tier { font-size:8px; font-weight:800; padding:1px 4px; border-radius:3px; margin-top:1px; text-transform:uppercase; letter-spacing:.5px; }
          @keyframes emPulse { 0%{transform:scale(1);opacity:.55} 70%{transform:scale(1.65);opacity:0} 100%{opacity:0} }
          @keyframes emBob   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        `
        document.head.appendChild(s)
      }

      spawnedEnemies.forEach(spawn => {
        const tc = spawn.enemy.tier === 'legendary' ? '#f59e0b'
          : spawn.enemy.tier === 'rare' ? '#8b5cf6' : '#6b7280'
        const isLeg = spawn.enemy.tier === 'legendary'
        const sz = isLeg ? 58 : 52
        const pulseOff = Math.floor(sz * 0.12)

        const el = document.createElement('div')
        el.innerHTML = `
          <div class="em-wrap">
            <div class="em-pulse ${isLeg ? 'legendary' : ''}"
              style="width:${sz + pulseOff * 2}px;height:${sz + pulseOff * 2}px;
                     top:-${pulseOff}px;left:-${pulseOff}px;
                     border:2px solid ${tc}; background:${tc}18;">
            </div>
            <div class="em-img ${isLeg ? 'legendary' : ''}"
              style="width:${sz}px;height:${sz}px;
                     border:3px solid ${tc};
                     box-shadow:0 0 14px ${tc}77, 0 4px 14px rgba(0,0,0,0.6);">
              <img src="${spawn.enemy.image}"
                style="width:100%;height:100%;object-fit:cover;" />
            </div>
            <div class="em-name">${spawn.enemy.name}</div>
            <div class="em-tier"
              style="background:${tc}22;color:${tc};border:1px solid ${tc}44;">
              ${spawn.enemy.tier}
            </div>
          </div>
        `
        el.addEventListener('click', () =>
          router.push(`/battle?enemy=${spawn.enemy.id}&spawn=${spawn.id}`)
        )

        const marker = new mapboxgl.Marker({ element: el, anchor: 'top' })
          .setLngLat([spawn.lng, spawn.lat])
          .addTo(map.current!)
        markersRef.current.push(marker)
      })
    }

    if (map.current.isStyleLoaded()) addEnemies()
    else map.current.on('load', addEnemies)
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
    <div className="relative h-screen overflow-hidden">
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* ── HUD: Top Left ───────────────────────────────────────────────── */}
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
        <button
          onClick={togglePlayers}
          className={`backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2 transition-all ${
            showPlayers ? 'bg-blue-900/80 border border-blue-500/60' : 'bg-black/75 border border-transparent'
          }`}
        >
          <span className="text-xs">👥</span>
          <span className="text-white text-xs font-medium">Players {showPlayers ? 'On' : 'Off'}</span>
          {showPlayers && nearbyPlayers.length > 0 && (
            <span className="bg-blue-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {nearbyPlayers.length}
            </span>
          )}
        </button>
      </div>

      {/* ── HUD: Top Right — FP ─────────────────────────────────────────── */}
      <div className="absolute top-4 right-14 z-20">
        <div className="bg-black/75 backdrop-blur rounded-xl px-3 py-2">
          <span className="text-yellow-400 text-xs font-bold">⚡ {profile?.fp_balance?.toLocaleString() || 0} FP</span>
        </div>
      </div>

      {/* ── Bottom info bar ──────────────────────────────────────────────── */}
      <div className="absolute bottom-6 left-0 right-0 z-20 flex justify-center px-4">
        <div className="bg-black/75 backdrop-blur rounded-full px-5 py-2.5 flex items-center gap-3">
          <span className="text-white text-xs">{spawnedEnemies.length} enemies nearby</span>
          <div className="w-px h-3 bg-gray-600" />
          <span className="text-white text-xs">{gyms.length} town halls in range</span>
          {showPlayers && nearbyPlayers.length > 0 && (
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

      {/* ── Selected player bottom sheet ──────────────────────────────────── */}
      {selectedPlayer && !sentChallenge && (
        <div className="absolute bottom-20 left-4 right-4 z-30 bg-gray-900 rounded-2xl p-4 border border-gray-700 shadow-2xl">
          {/* Player header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
              style={{
                background: selectedPlayer.party === 'democrat' ? '#1e3a8a'
                  : selectedPlayer.party === 'republican' ? '#7f1d1d' : '#1f2937',
                border: `2px solid ${selectedPlayer.party === 'democrat' ? '#3b82f6'
                  : selectedPlayer.party === 'republican' ? '#ef4444' : '#6b7280'}`,
              }}>
              {selectedPlayer.party === 'democrat' ? '🔵' : selectedPlayer.party === 'republican' ? '🔴' : '⚪'}
            </div>
            <div>
              <div className="text-white font-bold">{selectedPlayer.username}</div>
              <div className="text-gray-400 text-xs">
                {selectedPlayer.party ? selectedPlayer.party.charAt(0).toUpperCase() + selectedPlayer.party.slice(1) : 'Affiliation hidden'}
              </div>
            </div>
            <button onClick={() => setSelectedPlayer(null)} className="ml-auto text-gray-500 hover:text-white text-xl leading-none">✕</button>
          </div>

          <div className="space-y-2">
            {/* Battle — only if both parties are visible and different */}
            {selectedPlayer.party && profile?.party && selectedPlayer.party !== profile.party && (
              <button
                onClick={() => sendChallenge(selectedPlayer)}
                disabled={challengeLoading || !profile || profile.fp_balance < 50}
                className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
              >
                {challengeLoading ? '⏳ Sending...' : '⚔️ Challenge to Battle (50 FP)'}
              </button>
            )}

            {/* Message — only if they allow messages */}
            {selectedPlayer.allow_messages && (
              <button
                onClick={() => startChat(selectedPlayer)}
                className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 bg-blue-900 hover:bg-blue-800 border border-blue-700"
              >
                💬 Send Message
              </button>
            )}

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
      {/* ── Incoming chat request modal ───────────────────────────────────── */}
      {incomingChatReq && !activeChatUserId && (
        <div className="absolute inset-0 z-40 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-gray-900 rounded-2xl p-6 border border-blue-500/50 shadow-2xl w-full max-w-sm">
            <div className="text-center mb-5">
              <div className="text-5xl mb-3">💬</div>
              <h2 className="text-white font-black text-xl">Chat Request</h2>
              <p className="text-gray-400 text-sm mt-2">
                <span className={`font-bold ${
                  incomingChatReq.sender_party === 'democrat' ? 'text-blue-400'
                  : incomingChatReq.sender_party === 'republican' ? 'text-red-400'
                  : 'text-gray-300'
                }`}>
                  {incomingChatReq.sender_username}
                </span>{' '}
                wants to chat with you
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => respondToChatReq(false)}
                className="py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-bold transition">
                Decline
              </button>
              <button onClick={() => respondToChatReq(true)}
                className="py-3 bg-blue-700 hover:bg-blue-600 text-white rounded-xl font-bold transition">
                💬 Accept
              </button>
            </div>
          </div>
        </div>
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
                    <div className="max-w-[75%] px-3 py-1.5 rounded-xl text-sm text-white"
                      style={{
                        background: isMe ? '#1d4ed8' : '#1f2937',
                        borderBottomRightRadius: isMe ? 4 : undefined,
                        borderBottomLeftRadius: isMe ? undefined : 4,
                      }}>
                      {msg.content}
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

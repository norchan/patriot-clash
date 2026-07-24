'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { useLocation } from '@/hooks/useLocation'
import { Shield, Sword, MessageSquare, ArrowLeft, ChevronDown } from 'lucide-react'
import HallFeed from '@/components/HallFeed'

interface Gym {
  id: string
  city_name: string
  county: string
  state: string
  population: number
  holder_id: string | null
  holder_party: 'democrat' | 'republican' | null
  holder_username: string | null
  holder_message: string | null
  defense_points: number
  held_since: string | null
  total_captures: number
  distance_miles: string
  radius_miles: number
  latitude: number
  longitude: number
}

const DEFENSE_ITEMS = [
  { id: 'iron_firewall',   name: 'Iron Firewall',   desc: '+20% defense, 24h',          cost: 200,  emoji: '🛡️' },
  { id: 'sandbag_wall',    name: 'Sandbag Wall',    desc: '+500 defense points',         cost: 350,  emoji: '🪨' },
  { id: 'decoy_gym',       name: 'Decoy Gym',       desc: 'Absorbs 1 full attack',       cost: 500,  emoji: '🎭' },
  { id: 'rally_beacon',    name: 'Rally Beacon',    desc: 'Notify allies on attack',     cost: 150,  emoji: '📡' },
  { id: 'bunker_protocol', name: 'Bunker Protocol', desc: '6hr full immunity',           cost: 1000, emoji: '🏰' },
]

export default function TownHallPage() {
  const router = useRouter()
  const params = useParams()
  const { profile, refetch } = useProfile()
  const { location } = useLocation()
  const [gym, setGym] = useState<Gym | null>(null)
  const [landmarkUrl, setLandmarkUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Local landmark photo for the hero (Wikipedia lead image; satellite fallback)
  useEffect(() => {
    fetch(`/api/gyms/${params.id}`)
      .then(r => r.json())
      .then(d => { if (d.gym) setLandmarkUrl(d.gym.landmark_url ?? null) })
      .catch(() => {})
  }, [params.id])
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [toast, setToast] = useState('')
  const [showDefense, setShowDefense] = useState(false)
  const [showMessage, setShowMessage] = useState(false)
  const [showDonate, setShowDonate] = useState(false)
  const [showCliques, setShowCliques] = useState(false)
  const [donateAmount, setDonateAmount] = useState('')
  const [localCliques, setLocalCliques] = useState<{ id: string; name: string; party: string; member_count: number }[]>([])

  useEffect(() => {
    if (!gym?.id) return
    fetch(`/api/cliques?gym_id=${gym.id}`)
      .then(r => r.json())
      .then(d => setLocalCliques(d.cliques ?? []))
      .catch(() => {})
  }, [gym?.id])

  useEffect(() => {
    if (!location) return
    fetch(`/api/gyms?lat=${location.lat}&lng=${location.lng}`)
      .then(r => r.json())
      .then(data => {
        const found = data.gyms?.find((g: Gym) => g.id === params.id)
        if (found) setGym(found)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [location, params.id])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Attacking opens Siege Mode — the animated hall assault screen
  function handleChallenge() {
    if (!gym) return
    router.push(`/battle/siege?gym=${gym.id}`)
  }

  async function handleBuyDefense(itemId: string, cost: number) {
    if (!profile || !gym) return
    if (profile.fp_balance < cost) { showToast(`❌ Need ${cost} FP`); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/gyms/${gym.id}/defend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_type: itemId }),
      })
      const data = await res.json()
      showToast(data.message || '🛡️ Defense activated!')
      await refetch()
    } catch { showToast('❌ Failed') }
    finally { setActionLoading(false); setShowDefense(false) }
  }

  async function handleDonate(amount: number) {
    if (!profile || !gym) return
    if (amount < 10) { showToast('❌ Minimum donation is 10 FP'); return }
    if (profile.fp_balance < amount) { showToast(`❌ Need ${amount.toLocaleString()} FP`); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/gyms/${gym.id}/donate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(data.message || '🏛️ Donation received!')
        setGym(prev => prev ? { ...prev, defense_points: data.defense_points } : prev)
        setDonateAmount('')
      } else {
        showToast(`❌ ${data.error || 'Donation failed'}`)
      }
      await refetch()
    } catch { showToast('❌ Donation failed') }
    finally { setActionLoading(false) }
  }

  async function handlePostMessage() {
    if (!gym || !message.trim()) return
    setActionLoading(true)
    try {
      await fetch(`/api/gyms/${gym.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      })
      setGym(prev => prev ? { ...prev, holder_message: message.trim() } : prev)
      showToast('📢 Message posted!')
      setShowMessage(false)
      setMessage('')
    } catch { showToast('❌ Failed') }
    finally { setActionLoading(false) }
  }

  const isHolder = profile?.id === gym?.holder_id
  const battleRadius = 10 // flat 10-mile attack range for every hall
  const inRange = !gym?.distance_miles || parseFloat(gym.distance_miles) <= battleRadius
  const partyColor = gym?.holder_party === 'democrat' ? '#2563eb' : gym?.holder_party === 'republican' ? '#dc2626' : '#6b7280'
  const flagEmoji = gym?.holder_party === 'democrat' ? '🔵' : gym?.holder_party === 'republican' ? '🔴' : '⚪'
  const dayHeld = gym?.held_since ? Math.floor((Date.now() - new Date(gym.held_since).getTime()) / 86400000) : 0

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400">Loading Town Hall...</div>
    </div>
  )

  if (!gym) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="text-4xl mb-4">🏛️</div>
      <p className="text-gray-400 text-center">Town Hall not found or out of range.</p>
      <button onClick={() => router.push('/map')} className="mt-4 text-blue-400">← Back to Map</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white">
            <ArrowLeft size={16} /><span className="text-sm">Back</span>
          </button>
        </div>
        <h1 className="text-white font-bold text-xl">{gym.city_name} Town Hall</h1>
        <p className="text-gray-500 text-sm">{gym.county} County, {gym.state} • Pop. {gym.population?.toLocaleString()}</p>
      </div>

      {/* Landmark hero — a photo of something local, holder banner on top */}
      <div className="relative h-44 overflow-hidden">
        <img
          src={landmarkUrl
            ?? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${gym.longitude},${gym.latitude},13,0/640x360?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`}
          alt={`${gym.city_name} landmark`}
          className="absolute inset-0 w-full h-full object-cover"
          onError={e => {
            // broken Wikipedia URL → drop to the satellite view
            const fallback = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${gym.longitude},${gym.latitude},13,0/640x360?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`
            if ((e.target as HTMLImageElement).src !== fallback) (e.target as HTMLImageElement).src = fallback
          }}
        />
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${partyColor}22 0%, transparent 35%, rgba(3,7,18,0.55) 100%)` }} />
        <div className="absolute bottom-3 left-3 right-3 bg-black/70 backdrop-blur-sm rounded-xl p-3 flex items-center justify-between">
          <div>
            {gym.holder_username
              ? <>
                  <span className="text-white text-sm">
                    🏆 Held by{' '}
                    <button
                      onClick={() => gym.holder_id && router.push(`/player/${gym.holder_id}`)}
                      className="font-bold underline decoration-dotted underline-offset-2 hover:text-blue-300 transition"
                    >
                      {gym.holder_username}
                    </button>
                  </span>
                  <span className="text-gray-400 text-xs block">{dayHeld} day{dayHeld !== 1 ? 's' : ''}</span>
                </>
              : <span className="text-gray-400 text-sm">⚪ Unclaimed</span>
            }
          </div>
          {gym.holder_party && (
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              gym.holder_party === 'democrat' ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300'
            }`}>
              {gym.holder_party === 'democrat' ? 'Democrat' : 'Republican'}
            </span>
          )}
        </div>
      </div>

      {/* Attack — directly under the holder's name, enemy/unclaimed halls only */}
      {(!gym.holder_party || profile?.party !== gym.holder_party) && (
        <div className="mx-4 mt-3 space-y-2">
          <button
            onClick={handleChallenge}
            disabled={actionLoading || (profile?.fp_balance || 0) < 100 || !inRange}
            className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition"
          >
            <Sword size={18} />
            {gym.holder_party ? 'Attack Town Hall (100 FP)' : 'Claim Town Hall (100 FP)'}
          </button>
          {!inRange && (
            <p className="text-orange-400 text-xs text-center">
              📍 Must be within {battleRadius} miles — you are {gym.distance_miles} mi away
            </p>
          )}
        </div>
      )}

      {/* Message */}
      {gym.holder_message && (
        <div className="mx-4 mt-3 bg-gray-900 rounded-xl p-3 border-l-4" style={{ borderColor: partyColor }}>
          <p className="text-gray-500 text-xs mb-1">Message from holder:</p>
          <p className="text-gray-200 text-sm">"{gym.holder_message}"</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mx-4 mt-3">
        {[
          { label: 'Defense Points', value: gym.defense_points?.toLocaleString() },
          { label: 'Days Held', value: dayHeld },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-900 rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">{label}</p>
            <p className="text-white font-bold text-xl">{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mx-4 mt-4 space-y-3">


        {/* Donate — any same-party player can reinforce this hall */}
        {gym.holder_party && profile?.party === gym.holder_party && (
          <>
            <button onClick={() => setShowDonate(!showDonate)}
              className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition">
              🏛️ Donate Fighting Points
            </button>

            {showDonate && (
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="text-gray-400 text-xs mb-3">
                  1 FP = 1 defense point. Reinforce your party's hold on {gym.city_name}!
                </p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[100, 500, 1000].map(amt => (
                    <button key={amt}
                      onClick={() => handleDonate(amt)}
                      disabled={actionLoading || (profile?.fp_balance || 0) < amt}
                      className="py-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm font-bold hover:bg-gray-700 disabled:opacity-40 transition"
                    >
                      ⚡ {amt.toLocaleString()}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={10}
                    max={10000}
                    value={donateAmount}
                    onChange={e => setDonateAmount(e.target.value)}
                    placeholder="Custom amount (10–10,000)"
                    className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-600 border border-gray-700 focus:border-gray-500"
                  />
                  <button
                    onClick={() => handleDonate(Math.floor(Number(donateAmount)))}
                    disabled={actionLoading || !donateAmount || Number(donateAmount) < 10}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-black text-sm font-bold rounded-xl transition"
                  >
                    Donate
                  </button>
                </div>
                <p className="text-gray-600 text-xs mt-2 text-right">
                  Your balance: ⚡ {profile?.fp_balance?.toLocaleString() || 0} FP
                </p>
              </div>
            )}
          </>
        )}

        {isHolder && (
          <>
            <button onClick={() => setShowDefense(!showDefense)}
              className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition">
              <Shield size={18} />Buy Defense Upgrade
            </button>

            {showDefense && (
              <div className="space-y-2">
                {DEFENSE_ITEMS.map(item => (
                  <button key={item.id}
                    onClick={() => handleBuyDefense(item.id, item.cost)}
                    disabled={actionLoading || (profile?.fp_balance || 0) < item.cost}
                    className="w-full p-3 bg-gray-900 border border-gray-700 rounded-xl flex items-center gap-3 hover:bg-gray-800 disabled:opacity-50 transition"
                  >
                    <span className="text-2xl">{item.emoji}</span>
                    <div className="flex-1 text-left">
                      <div className="text-white text-sm font-medium">{item.name}</div>
                      <div className="text-gray-500 text-xs">{item.desc}</div>
                    </div>
                    <div className="text-yellow-400 text-sm font-bold">{item.cost} FP</div>
                  </button>
                ))}
              </div>
            )}

            <button onClick={() => setShowMessage(!showMessage)}
              className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition">
              <MessageSquare size={18} />Post Message
            </button>

            {showMessage && (
              <div className="bg-gray-900 rounded-xl p-3">
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value.slice(0, 280))}
                  placeholder="What do you want the world to know? (280 chars)"
                  className="w-full bg-gray-800 text-white rounded-lg p-3 text-sm resize-none border border-gray-700 focus:border-gray-500 outline-none"
                  rows={3}
                />
                <div className="flex justify-between items-center mt-2">
                  <span className="text-gray-500 text-xs">{message.length}/280</span>
                  <button onClick={handlePostMessage} disabled={!message.trim() || actionLoading}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                    Post
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Arcade — every hall links to the one shared arcade */}
      <div className="mx-4 mt-3">
        <button onClick={() => router.push('/arcade')}
          className="w-full py-3 rounded-xl font-bold text-white transition flex items-center justify-center gap-2 border"
          style={{ background: 'linear-gradient(180deg, rgba(6,78,59,0.5), rgba(6,40,30,0.6))', borderColor: '#34d399' }}>
          🕹️ Enter the Arcade
        </button>
      </div>

      {/* Local Players — jump to the nearby active-players list */}
      <div className="mx-4 mt-3">
        <button onClick={() => router.push('/active')}
          className="w-full py-3 rounded-xl font-bold text-white transition flex items-center justify-center gap-2 border"
          style={{ background: 'linear-gradient(180deg, rgba(6,78,59,0.5), rgba(6,40,30,0.6))', borderColor: '#34d399' }}>
          ✊ Local Players
        </button>
      </div>

      {/* Local Cliques — collapsed to one button; tap to expand */}
      {localCliques.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl overflow-hidden border"
          style={{ background: 'linear-gradient(180deg, rgba(6,78,59,0.5), rgba(6,40,30,0.6))', borderColor: '#34d399' }}>
          <button onClick={() => setShowCliques(v => !v)}
            className="w-full py-3 px-4 flex items-center justify-center gap-2 text-white font-bold transition">
            <span>✊ Local Cliques</span>
            <ChevronDown size={18} className={`text-gray-500 transition-transform ${showCliques ? 'rotate-180' : ''}`} />
          </button>
          {showCliques && (
            <div className="px-3 pb-3">
              <p className="text-gray-600 text-xs mb-2 px-1">
                Each clique adds +500 starting defense when its party captures this hall
              </p>
              <div className="space-y-1">
                {localCliques.map(c => {
                  const cColor = c.party === 'democrat' ? '#2563eb' : '#dc2626'
                  return (
                    <button key={c.id} onClick={() => router.push('/cliques')}
                      className="w-full flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-gray-800 transition text-left">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cColor }} />
                      <span className="text-white text-sm font-medium flex-1 truncate">{c.name}</span>
                      <span className="text-gray-500 text-xs flex-shrink-0">
                        {c.member_count} member{c.member_count !== 1 ? 's' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Town square — the hall's post thread */}
      <div className="mx-4 mt-5 pb-8">
        {/* the hall's own psub — its State button widens to the whole state */}
        <h2 className="text-white font-black text-lg uppercase tracking-[0.2em] text-center mb-1">🏛️ Town Square</h2>
        <p className="text-center text-purple-400 font-black text-xs mb-3">
          p/{`${gym.city_name ?? ''}-${gym.state ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}
        </p>
        <HallFeed gymId={gym.id} />
      </div>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
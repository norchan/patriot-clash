'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { useLocation } from '@/hooks/useLocation'
import { Shield, Sword, MessageSquare, ArrowLeft } from 'lucide-react'

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
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [toast, setToast] = useState('')
  const [showDefense, setShowDefense] = useState(false)
  const [showMessage, setShowMessage] = useState(false)

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

  async function handleChallenge() {
    if (!profile || !location || !gym) return
    if (profile.fp_balance < 100) { showToast('❌ Need at least 100 FP!'); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/gyms/${gym.id}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: location.lat, longitude: location.lng, fp_spent: 100 }),
      })
      const data = await res.json()
      showToast(data.message || (data.captured ? '🎉 Captured!' : '❌ Repelled!'))
      if (data.captured) {
        setGym(prev => prev ? { ...prev, holder_id: profile.id, holder_party: profile.party, holder_username: profile.username, defense_points: 0 } : prev)
      }
      await refetch()
    } catch { showToast('❌ Challenge failed.') }
    finally { setActionLoading(false) }
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
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-3 hover:text-white">
          <ArrowLeft size={16} /><span className="text-sm">Back</span>
        </button>
        <h1 className="text-white font-bold text-xl">{gym.city_name} Town Hall</h1>
        <p className="text-gray-500 text-sm">{gym.county} County, {gym.state} • Pop. {gym.population?.toLocaleString()}</p>
      </div>

      {/* Flag hero */}
      <div className="relative h-36 flex items-center justify-center"
        style={{ background: `linear-gradient(180deg, ${partyColor}22 0%, transparent 100%)` }}>
        <div className="text-6xl">{flagEmoji}</div>
        <div className="absolute bottom-3 left-3 right-3 bg-black/70 rounded-xl p-3 flex items-center justify-between">
          <div>
            {gym.holder_username
              ? <><span className="text-white text-sm">🏆 Held by <strong>{gym.holder_username}</strong></span>
                  <span className="text-gray-400 text-xs block">{dayHeld} day{dayHeld !== 1 ? 's' : ''}</span></>
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
          { label: 'Total Captures', value: gym.total_captures },
          { label: 'Your Distance', value: `${gym.distance_miles} mi` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-900 rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">{label}</p>
            <p className="text-white font-bold text-xl">{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mx-4 mt-4 space-y-3 pb-6">
        {!isHolder && (
          <button
            onClick={handleChallenge}
            disabled={actionLoading || (profile?.fp_balance || 0) < 100}
            className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition"
          >
            <Sword size={18} />Challenge Town Hall (100 FP)
          </button>
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
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

const OPTIONS = [
  {
    value: 'everyone',
    emoji: '🌎',
    label: 'Visible to everyone',
    sub: 'Democrats and Republicans can both see you on the map',
  },
  {
    value: 'hide_from_republicans',
    emoji: '🙈🔴',
    label: 'Incognito to Republicans',
    sub: 'Republicans can’t see you — Democrats still can',
  },
  {
    value: 'hide_from_democrats',
    emoji: '🙈🔵',
    label: 'Incognito to Democrats',
    sub: 'Democrats can’t see you — Republicans still can',
  },
  {
    value: 'nobody',
    emoji: '👻',
    label: 'Fully incognito',
    sub: 'Nobody can see you on the map at all',
  },
] as const

export default function MapSettingsPage() {
  const router = useRouter()
  const { profile, loading, refetch } = useProfile()
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState<string>('everyone')
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

  useEffect(() => {
    if (profile) setCurrent((profile as any).map_visibility ?? 'everyone')
  }, [profile])

  async function choose(value: string) {
    if (saving || value === current) return
    setSaving(true)
    const prev = current
    setCurrent(value)
    try {
      const res = await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_visibility: value }),
      })
      if (!res.ok) setCurrent(prev)
      else refetch()
    } catch { setCurrent(prev) }
    setSaving(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-500 text-sm">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-white font-bold text-lg">🗺️ Map Settings</h1>
      </div>

      <div className="p-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-1 px-1">Who can see you</h3>
        <p className="text-gray-600 text-xs mb-3 px-1">
          Controls your marker on other players’ maps. Blocked players can never see you (and you can’t see them), no matter what you pick here.
        </p>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          {OPTIONS.map(o => {
            const active = current === o.value
            return (
              <button
                key={o.value}
                onClick={() => choose(o.value)}
                disabled={saving}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition border-b border-gray-800 last:border-0 disabled:opacity-60 ${
                  active ? 'bg-gray-800/70' : 'hover:bg-gray-800/40'
                }`}
              >
                <span className="text-xl w-10 flex-shrink-0">{o.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold ${active ? 'text-white' : 'text-gray-300'}`}>{o.label}</div>
                  <div className="text-gray-500 text-xs">{o.sub}</div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  active ? 'border-green-500' : 'border-gray-600'
                }`}>
                  {active && <span className="w-2.5 h-2.5 rounded-full bg-green-500" />}
                </span>
              </button>
            )
          })}
        </div>

        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-1 px-1 mt-6">Location accuracy</h3>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <button
            onClick={toggleFuzz}
            disabled={fuzzBusy}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-800/40 transition disabled:opacity-60"
          >
            <div className="text-left flex-1 min-w-0">
              <div className="text-white text-sm font-bold">🎲 Offset my location ~1 mile</div>
              <div className="text-gray-500 text-xs">Your marker shows about a mile from where you really are (same direction every time). Also in the map's Show-on-map menu.</div>
            </div>
            <div className="ml-3 flex-shrink-0 w-12 h-6 rounded-full relative transition-colors"
              style={{ background: locationFuzz ? '#16a34a' : '#374151' }}>
              <div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all"
                style={{ left: locationFuzz ? 26 : 2 }} />
            </div>
          </button>
        </div>

        <div className="mt-4 bg-gray-900/60 border border-gray-800 rounded-xl p-3 flex gap-2.5">
          {current === 'everyone' ? <Eye size={16} className="text-green-400 flex-shrink-0 mt-0.5" /> : <EyeOff size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />}
          <p className="text-gray-500 text-xs">
            {current === 'everyone'
              ? 'You’re on the grid. Rivals can find you — and challenge you.'
              : 'Heads up: players who can’t see you also can’t challenge you to PvP from the map. Hiding works both ways in spirit — hunt accordingly.'}
          </p>
        </div>
      </div>
    </div>
  )
}

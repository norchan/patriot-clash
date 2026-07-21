'use client'
import { useEffect, useState } from 'react'

// Settings card: view + change your ASSIGNED TOWN HALL. Joining a clique
// overwrites it with the clique's hall; otherwise it's yours to pick.

interface HallOpt { id: string; city_name: string; state: string; holder_party: string | null }

export default function HomeHallPicker() {
  const [current, setCurrent] = useState<HallOpt | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<HallOpt[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/profile/home-gym')
      .then(r => r.json())
      .then(d => setCurrent(d.gym ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(() => {
      fetch(`/api/gyms/search?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json())
        .then(d => setResults(d.gyms ?? []))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  async function pick(g: HallOpt) {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/profile/home-gym', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gym_id: g.id }),
      })
      if (res.ok) { setCurrent(g); setEditing(false); setQ(''); setResults([]) }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="text-left">
          <div className="text-white text-sm font-bold">🏛️ My Town Hall</div>
          <div className="text-gray-500 text-xs">
            {!loaded ? 'Loading…' : current ? `${current.city_name}, ${current.state}` : 'Not assigned yet — set it here'}
          </div>
        </div>
        <button onClick={() => setEditing(e => !e)}
          className="text-purple-400 text-xs font-black hover:text-purple-300">
          {editing ? 'Close' : 'Change'}
        </button>
      </div>
      {editing && (
        <div className="px-4 pb-4 border-t border-gray-800 pt-3">
          <input value={q} onChange={e => setQ(e.target.value)} autoFocus
            placeholder="Search a city… (e.g. St. Peter)"
            className="w-full px-3.5 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-white text-sm placeholder-gray-600 outline-none focus:border-purple-600" />
          <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
            {results.map(g => (
              <button key={g.id} onClick={() => pick(g)} disabled={saving}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-gray-200 hover:bg-white/5 disabled:opacity-50">
                <span className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: g.holder_party === 'democrat' ? '#3b82f6' : g.holder_party === 'republican' ? '#ef4444' : '#6b7280' }} />
                {g.city_name}, {g.state}
              </button>
            ))}
            {q.trim().length >= 2 && results.length === 0 && (
              <p className="text-gray-600 text-xs text-center py-2">No town matches “{q.trim()}”</p>
            )}
          </div>
          <p className="text-gray-600 text-[11px] mt-2">Joining a clique switches this to the clique&apos;s hall.</p>
        </div>
      )}
    </div>
  )
}

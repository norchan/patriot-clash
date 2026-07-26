'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { powWowIsLive } from '@/lib/cliques'

// ACTIVE CLIQUES (Michael): the dedicated search/create page. Search runs
// across BOTH parties (joining stays party-bound — the other party's
// cliques are visible, not joinable). Create + leave live here too; the
// panel/chat stays on /cliques.

interface Clique {
  id: string
  name: string
  party: 'democrat' | 'republican'
  gym_id: string | null
  member_count: number
  join_policy?: 'open' | 'request'
  pow_wow_at?: string | null
}

interface GymHit {
  id: string
  city_name: string
  state: string
}

const PARTY_COLORS: Record<string, string> = { democrat: '#2563eb', republican: '#dc2626' }

export default function CliqueBrowsePage() {
  const router = useRouter()
  const { profile, loading: profileLoading, refetch } = useProfile()
  const [cliques, setCliques] = useState<Clique[]>([])
  const [myCliqueIds, setMyCliqueIds] = useState<string[]>([])
  const [myDefaultId, setMyDefaultId] = useState<string | null>(null)
  const [myPendingId, setMyPendingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [partyFilter, setPartyFilter] = useState<'all' | 'democrat' | 'republican'>('all')
  const [powWowOnly, setPowWowOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [gymQuery, setGymQuery] = useState('')
  const [gymHits, setGymHits] = useState<GymHit[]>([])
  const [pickedGym, setPickedGym] = useState<GymHit | null>(null)

  const myColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'

  function showToastMsg(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const loadCliques = useCallback(async () => {
    try {
      const params = new URLSearchParams({ party: partyFilter })
      if (search) params.set('q', search)
      if (powWowOnly) params.set('powwow', '1')
      const res = await fetch(`/api/cliques?${params}`)
      const data = await res.json()
      setCliques(data.cliques ?? [])
      setMyCliqueIds(data.my_clique_ids ?? [])
      setMyDefaultId(data.my_default_id ?? null)
      setMyPendingId(data.my_pending_id ?? null)
    } catch {}
    setLoading(false)
  }, [search, partyFilter, powWowOnly])

  useEffect(() => { loadCliques() }, [loadCliques])

  // Town hall search for the create form
  useEffect(() => {
    if (gymQuery.length < 2) { setGymHits([]); return }
    const t = setTimeout(() => {
      fetch(`/api/gyms/search?q=${encodeURIComponent(gymQuery)}`)
        .then(r => r.json())
        .then(d => setGymHits(d.gyms ?? []))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [gymQuery])

  async function joinClique(c: Clique) {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${c.id}/join`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        if (data.status === 'member') {
          showToastMsg(`🎉 Joined ${c.name}!`)
          await Promise.all([loadCliques(), refetch()])
        } else {
          showToastMsg(`📨 Request sent to ${c.name} — waiting for approval`)
          setMyPendingId(c.id)
          await Promise.all([loadCliques(), refetch()])
        }
      } else {
        showToastMsg(`❌ ${data.error || 'Could not join'}`)
      }
    } catch { showToastMsg('❌ Could not join') }
    setBusy(false)
  }

  async function leaveClique(c: Clique) {
    setBusy(true)
    try {
      await fetch('/api/cliques/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clique_id: c.id }),
      })
      showToastMsg(`👋 Left ${c.name}`)
      await Promise.all([loadCliques(), refetch()])
    } catch {}
    setBusy(false)
  }

  async function createClique() {
    if (!newName.trim() || !pickedGym) return
    setBusy(true)
    try {
      const res = await fetch('/api/cliques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), gym_id: pickedGym.id }),
      })
      const data = await res.json()
      if (res.ok) {
        showToastMsg(`🎉 ${data.clique.name} created!`)
        setShowCreate(false)
        setNewName('')
        setGymQuery('')
        setPickedGym(null)
        await Promise.all([loadCliques(), refetch()])
      } else {
        showToastMsg(`❌ ${data.error || 'Could not create'}`)
      }
    } catch { showToastMsg('❌ Could not create') }
    setBusy(false)
  }

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      {/* Header */}
      <div className="px-4 pt-8 pb-4"
        style={{ background: `linear-gradient(180deg, ${myColor}26 0%, transparent 100%)` }}>
        <button onClick={() => router.push('/cliques')} className="text-gray-400 text-sm mb-2 hover:text-white">
          ← My cliques
        </button>
        <h1 className="text-white font-black text-2xl">🔍 Active Cliques</h1>
        <p className="text-gray-400 text-sm mt-1">
          Search every clique in the country — or start your own
        </p>
      </div>

      {/* Create — the form lives HERE now, not on the panel page */}
      <div className="mx-4 mb-4">
        {!showCreate ? (
          <button onClick={() => setShowCreate(true)}
            className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95"
            style={{ background: `linear-gradient(135deg, ${myColor}, ${myColor}bb)` }}>
            + Create A Clique
          </button>
        ) : (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-xs uppercase tracking-wider">Create A Clique</span>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <input
              type="text" value={newName} maxLength={30}
              onChange={e => setNewName(e.target.value)}
              placeholder="Clique name (e.g. Red Storm)"
              className="w-full bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none placeholder-gray-600 border border-gray-700 focus:border-gray-500"
            />
            {!pickedGym ? (
              <>
                <input
                  type="text" value={gymQuery}
                  onChange={e => setGymQuery(e.target.value)}
                  placeholder="Search a town hall (e.g. St. Peter)"
                  className="w-full bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none placeholder-gray-600 border border-gray-700 focus:border-gray-500"
                />
                {gymHits.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {gymHits.map(g => (
                      <button key={g.id} onClick={() => setPickedGym(g)}
                        className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-200 transition">
                        🏛️ {g.city_name}, {g.state}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2.5">
                <span className="text-white text-sm">🏛️ {pickedGym.city_name}, {pickedGym.state}</span>
                <button onClick={() => setPickedGym(null)} className="text-gray-500 hover:text-white text-xs">change</button>
              </div>
            )}
            {newName.trim() && pickedGym && (
              <p className="text-gray-500 text-xs">
                Will be named: <span className="text-white font-medium">{newName.trim()} — {pickedGym.city_name}</span>
              </p>
            )}
            <button onClick={createClique} disabled={busy || !newName.trim() || !pickedGym}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${myColor}, ${myColor}bb)` }}>
              {busy ? '⏳ Creating...' : 'Create Clique'}
            </button>
          </div>
        )}
      </div>

      {/* Search + party filter */}
      <div className="mx-4">
        <input
          type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cliques..."
          className="w-full bg-gray-900 text-white text-sm rounded-xl px-4 py-3 outline-none placeholder-gray-600 border border-gray-800 focus:border-gray-600 mb-3"
        />
        <div className="flex gap-2 mb-3 flex-wrap">
          {([['all', 'All'], ['democrat', 'Democrat'], ['republican', 'Republican']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setPartyFilter(key)}
              className={`px-3.5 py-2 rounded-full text-xs font-black border transition ${
                partyFilter === key ? 'text-white' : 'text-gray-400 border-gray-800 bg-gray-900 hover:text-white'}`}
              style={partyFilter === key
                ? { borderColor: key === 'democrat' ? '#2563eb' : key === 'republican' ? '#dc2626' : '#7c3aed',
                    background: `${key === 'democrat' ? '#2563eb' : key === 'republican' ? '#dc2626' : '#7c3aed'}33` }
                : undefined}>
              {label}
            </button>
          ))}
          {/* live pow-wows only — stacks with the party filter */}
          <button onClick={() => setPowWowOnly(v => !v)}
            className={`px-3.5 py-2 rounded-full text-xs font-black border transition ${
              powWowOnly ? 'text-amber-300 border-amber-600 bg-amber-900/30' : 'text-gray-400 border-gray-800 bg-gray-900 hover:text-white'}`}>
            🪶 Pow-Wows
          </button>
        </div>

        {loading ? (
          <p className="text-gray-600 text-sm text-center py-6">Loading cliques...</p>
        ) : cliques.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6">
            No cliques found — create the first one!
          </p>
        ) : (
          <div className="space-y-2">
            {cliques.map(c => {
              const cColor = PARTY_COLORS[c.party] ?? '#6b7280'
              const isMine = myCliqueIds.includes(c.id)
              const sameParty = c.party === profile?.party
              return (
                <div key={c.id} className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: `${cColor}22`, border: `1px solid ${cColor}44` }}>
                    ✊
                  </div>
                  <button onClick={() => router.push(`/cliques/${c.id}`)} className="flex-1 min-w-0 text-left">
                    <p className="text-white text-sm font-bold truncate">
                      {(() => {
                        const i = c.name.lastIndexOf(' — ')
                        if (i < 0 || !c.gym_id) return c.name
                        return (
                          <>
                            {c.name.slice(0, i + 3)}
                            <span
                              role="link"
                              onClick={e => { e.stopPropagation(); router.push(`/townhall/${c.gym_id}`) }}
                              className="underline decoration-dotted underline-offset-2 hover:text-blue-300 transition"
                            >
                              {c.name.slice(i + 3)}
                            </span>
                          </>
                        )
                      })()}
                    </p>
                    <p className="text-gray-500 text-xs">
                      <span className="font-bold" style={{ color: cColor }}>{c.party === 'democrat' ? 'DEM' : 'REP'}</span>
                      {' · '}{c.member_count} member{c.member_count !== 1 ? 's' : ''}
                      {c.join_policy === 'open' ? ' · 🚪 Open' : ' · 🔒 Request'}
                      {powWowIsLive(c.pow_wow_at) && <span className="text-amber-400 font-bold"> · 🪶 Pow-Wow LIVE</span>}
                    </p>
                  </button>
                  {isMine ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ color: cColor, background: `${cColor}1a` }}>
                        {c.id === myDefaultId ? '⭐ Joined' : 'Joined'}
                      </span>
                      <button onClick={() => leaveClique(c)} disabled={busy}
                        className="text-xs font-bold text-gray-500 hover:text-red-400 transition disabled:opacity-50">
                        Leave
                      </button>
                    </div>
                  ) : c.id === myPendingId ? (
                    <span className="text-xs font-bold px-2 py-1 rounded-full text-yellow-400 bg-yellow-900/30">
                      Requested ⏳
                    </span>
                  ) : sameParty ? (
                    <button onClick={() => joinClique(c)} disabled={busy}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg text-white transition active:scale-95 disabled:opacity-50"
                      style={{ background: cColor }}>
                      {c.join_policy === 'open' ? 'Join' : 'Request'}
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-gray-600 flex-shrink-0">
                      {c.party === 'democrat' ? 'Dems only' : 'Reps only'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
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

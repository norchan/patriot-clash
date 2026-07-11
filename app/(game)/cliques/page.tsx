'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import CliqueFeed from '@/components/CliqueFeed'

interface Clique {
  id: string
  name: string
  party: 'democrat' | 'republican'
  gym_id: string | null
  member_count: number
  join_policy?: 'open' | 'request'
}

interface Member {
  id: string
  username: string
  avatar_url: string | null
  total_battles_won: number
}

interface PendingMember {
  id: string
  username: string
  avatar_url: string | null
}

interface GymHit {
  id: string
  city_name: string
  state: string
}

export default function CliquesPage() {
  const router = useRouter()
  const { profile, loading: profileLoading, refetch } = useProfile()
  const [cliques, setCliques] = useState<Clique[]>([])
  const [myCliqueId, setMyCliqueId] = useState<string | null>(null)
  const [myPendingId, setMyPendingId] = useState<string | null>(null)
  const [myMembers, setMyMembers] = useState<Member[]>([])
  const [pendingRequests, setPendingRequests] = useState<PendingMember[]>([])
  const [isCreator, setIsCreator] = useState(false)
  const [search, setSearch] = useState('')
  const [showBrowse, setShowBrowse] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [gymQuery, setGymQuery] = useState('')
  const [gymHits, setGymHits] = useState<GymHit[]>([])
  const [pickedGym, setPickedGym] = useState<GymHit | null>(null)

  const partyColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const partyName = profile?.party === 'democrat' ? 'Democrat' : 'Republican'

  function showToastMsg(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const loadCliques = useCallback(async () => {
    try {
      const res = await fetch(`/api/cliques${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      const data = await res.json()
      setCliques(data.cliques ?? [])
      setMyCliqueId(data.my_clique_id ?? null)
      setMyPendingId(data.my_pending_id ?? null)
    } catch {}
    setLoading(false)
  }, [search])

  useEffect(() => { loadCliques() }, [loadCliques])

  // Load my clique's roster + (if creator) pending join requests
  const loadMyClique = useCallback(() => {
    if (!myCliqueId) { setMyMembers([]); setPendingRequests([]); setIsCreator(false); return }
    fetch(`/api/cliques/${myCliqueId}`)
      .then(r => r.json())
      .then(d => {
        setMyMembers(d.members ?? [])
        setPendingRequests(d.pending ?? [])
        setIsCreator(!!d.is_creator)
      })
      .catch(() => {})
  }, [myCliqueId])

  useEffect(() => { loadMyClique() }, [loadMyClique])

  async function manageMember(profileId: string, action: 'approve' | 'deny' | 'remove') {
    if (!myCliqueId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${myCliqueId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, action }),
      })
      if (res.ok) {
        showToastMsg(action === 'approve' ? '✅ Member approved!' : action === 'deny' ? 'Request denied' : 'Member removed')
        loadMyClique()
        loadCliques()
      }
    } catch {}
    setBusy(false)
  }

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
          // Open clique — you're straight in
          showToastMsg(`🎉 Joined ${c.name}!`)
          setMyCliqueId(c.id)
          await Promise.all([loadCliques(), refetch()])
          router.push(`/cliques/${c.id}`)
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

  async function leaveClique() {
    setBusy(true)
    try {
      await fetch('/api/cliques/leave', { method: 'POST' })
      showToastMsg('👋 Left your clique')
      setMyCliqueId(null)
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
        setMyCliqueId(data.clique.id)
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

  const myClique = cliques.find(c => c.id === myCliqueId)

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      {/* Header */}
      <div className="px-4 pt-8 pb-4"
        style={{ background: `linear-gradient(180deg, ${partyColor}26 0%, transparent 100%)` }}>
        <h1 className="text-white font-black text-2xl">✊ Cliques</h1>
        <p className="text-gray-400 text-sm mt-1">
          {partyName} cliques — band together around a town hall
        </p>
      </div>

      {/* My click */}
      {myCliqueId && (
        <div className="mx-4 mb-4 bg-gray-900 rounded-2xl border p-4" style={{ borderColor: `${partyColor}66` }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wider" style={{ color: partyColor }}>Your Clique</span>
            <button onClick={leaveClique} disabled={busy}
              className="text-xs text-gray-500 hover:text-red-400 transition disabled:opacity-50">
              Leave
            </button>
          </div>
          {/* Tap the clique to expand/collapse the member roster; the town
              name inside it links to that town hall */}
          <button onClick={() => setShowMembers(v => !v)} className="text-left w-full mb-2">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">
                {(() => {
                  const nm = myClique?.name ?? '...'
                  const i = nm.lastIndexOf(' — ')
                  if (i < 0 || !myClique?.gym_id) return nm
                  return (
                    <>
                      {nm.slice(0, i + 3)}
                      <span
                        role="link"
                        onClick={e => { e.stopPropagation(); router.push(`/townhall/${myClique.gym_id}`) }}
                        className="underline decoration-dotted underline-offset-2 hover:text-blue-300 transition"
                      >
                        {nm.slice(i + 3)}
                      </span>
                    </>
                  )
                })()}
              </h2>
              <span className={`text-gray-500 text-xs transition-transform ${showMembers ? 'rotate-180' : ''}`}>▼</span>
            </div>
            <p className="text-gray-500 text-xs">
              {myMembers.length} member{myMembers.length !== 1 ? 's' : ''}{isCreator ? ' · you are the creator' : ''} · tap to {showMembers ? 'hide' : 'see'} members
            </p>
          </button>

          {/* pending join requests (creator only) */}
          {isCreator && pendingRequests.length > 0 && (
            <div className="mb-3 bg-gray-800/70 rounded-xl p-3">
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: partyColor }}>
                Join Requests ({pendingRequests.length})
              </p>
              <div className="space-y-2">
                {pendingRequests.map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                      : <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs">👤</div>}
                    <span className="text-gray-200 text-sm flex-1 truncate">{p.username}</span>
                    <button onClick={() => manageMember(p.id, 'approve')} disabled={busy}
                      className="w-8 h-8 rounded-lg bg-green-900/60 text-green-300 font-bold hover:bg-green-800/60 transition disabled:opacity-50">✓</button>
                    <button onClick={() => manageMember(p.id, 'deny')} disabled={busy}
                      className="w-8 h-8 rounded-lg bg-gray-700 text-gray-400 font-bold hover:bg-red-900/50 hover:text-red-300 transition disabled:opacity-50">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showMembers && (
            <div className="space-y-1.5">
              {myMembers.map(m => (
                <div key={m.id} className="flex items-center gap-2">
                  {/* Tap a member to open their profile */}
                  <button onClick={() => router.push(`/player/${m.id}`)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left rounded-lg px-1 py-0.5 hover:bg-gray-800 transition">
                    {m.avatar_url
                      ? <img src={m.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border" style={{ borderColor: partyColor }} />
                      : <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: `${partyColor}33` }}>👤</div>}
                    <span className="text-gray-300 text-sm flex-1 truncate">{m.username}</span>
                    <span className="text-gray-600 text-xs">⚔️ {m.total_battles_won}</span>
                  </button>
                  {isCreator && m.id !== profile?.id && (
                    <button onClick={() => manageMember(m.id, 'remove')} disabled={busy}
                      className="text-gray-700 hover:text-red-400 text-xs transition disabled:opacity-50" title="Remove from clique">✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clique chat — shown inline for members right under their clique info */}
      {myCliqueId && (
        <div className="mx-4 mb-4">
          <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2">💬 Clique Chat</h3>
          <CliqueFeed cliqueId={myCliqueId} partyColor={partyColor} isCreator={isCreator} />
        </div>
      )}

      {/* Create — hidden while you're in a clique (leave first) */}
      {!myCliqueId && (
      <div className="mx-4 mb-4">
        {!showCreate ? (
          <button onClick={() => setShowCreate(true)}
            className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95"
            style={{ background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)` }}>
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
              style={{ background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)` }}>
              {busy ? '⏳ Creating...' : 'Create Clique'}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Members: collapse the browse list into a "find other cliques" toggle
          below the chat — no need to shop for cliques while you're in one */}
      {myCliqueId && !showBrowse && (
        <div className="mx-4 mb-4">
          <button onClick={() => setShowBrowse(true)}
            className="w-full py-2.5 rounded-xl text-sm font-bold bg-gray-900 text-gray-400 border border-gray-800 hover:text-white transition">
            🔍 Find other {partyName} cliques
          </button>
        </div>
      )}

      {/* Search + list */}
      {(!myCliqueId || showBrowse) && (
      <div className="mx-4">
        {myCliqueId && (
          <button onClick={() => setShowBrowse(false)} className="text-gray-500 text-xs mb-2">← Hide</button>
        )}
        <input
          type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${partyName} cliques...`}
          className="w-full bg-gray-900 text-white text-sm rounded-xl px-4 py-3 outline-none placeholder-gray-600 border border-gray-800 focus:border-gray-600 mb-3"
        />

        {loading ? (
          <p className="text-gray-600 text-sm text-center py-6">Loading cliques...</p>
        ) : cliques.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6">
            No {partyName} cliques yet — create the first one!
          </p>
        ) : (
          <div className="space-y-2">
            {cliques.map(c => (
              <div key={c.id} className="bg-gray-900 rounded-xl border border-gray-800 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: `${partyColor}22`, border: `1px solid ${partyColor}44` }}>
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
                    {c.member_count} member{c.member_count !== 1 ? 's' : ''}
                    {c.join_policy === 'open' ? ' · 🚪 Open' : ' · 🔒 Request'}
                  </p>
                </button>
                {c.id === myCliqueId ? (
                  <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ color: partyColor, background: `${partyColor}1a` }}>
                    Joined
                  </span>
                ) : c.id === myPendingId ? (
                  <span className="text-xs font-bold px-2 py-1 rounded-full text-yellow-400 bg-yellow-900/30">
                    Requested ⏳
                  </span>
                ) : (
                  <button onClick={() => joinClique(c)} disabled={busy || !!myCliqueId}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg text-white transition active:scale-95 disabled:opacity-50"
                    style={{ background: partyColor }}>
                    {c.join_policy === 'open' ? 'Join' : 'Request'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

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

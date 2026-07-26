'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import CliqueFeed from '@/components/CliqueFeed'

// MY CLIQUES (Michael): this page is the clique panel only — the dropdown
// next to the title switches between your cliques ("more cliques" at the
// bottom opens /cliques/browse). Search + create + leave-anything live on
// the browse page, not here.

interface Member {
  id: string
  username: string
  avatar_url: string | null
  total_battles_won: number
  pow_wow_guest?: boolean
}

interface PendingMember {
  id: string
  username: string
  avatar_url: string | null
}

export default function CliquesPage() {
  const router = useRouter()
  const { profile, loading: profileLoading, refetch } = useProfile()
  // myCliques = every membership; myDefaultId = the starred one;
  // myCliqueId = whichever membership's panel is open right now
  const [myCliques, setMyCliques] = useState<{ id: string; name: string; gym_id: string | null; join_policy?: string }[]>([])
  const [myDefaultId, setMyDefaultId] = useState<string | null>(null)
  const [myCliqueId, setMyCliqueId] = useState<string | null>(null)
  const [myMembers, setMyMembers] = useState<Member[]>([])
  const [myCliqueInfo, setMyCliqueInfo] = useState<{ name: string; gym_id: string | null; city?: string; state?: string } | null>(null)
  const [pendingRequests, setPendingRequests] = useState<PendingMember[]>([])
  const [isCreator, setIsCreator] = useState(false)
  const [powWow, setPowWow] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const partyColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const partyName = profile?.party === 'democrat' ? 'Democrat' : 'Republican'

  function showToastMsg(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const loadCliques = useCallback(async () => {
    try {
      const res = await fetch('/api/cliques')
      const data = await res.json()
      const mine = data.my_cliques ?? []
      setMyCliques(mine)
      setMyDefaultId(data.my_default_id ?? null)
      // The dropdown shows the default clique — its panel opens by default
      setMyCliqueId(prev => (prev && mine.some((m: any) => m.id === prev))
        ? prev
        : (data.my_default_id ?? mine[0]?.id ?? null))
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadCliques() }, [loadCliques])

  // Load my clique's roster + (if creator) pending join requests
  const loadMyClique = useCallback(() => {
    if (!myCliqueId) { setMyMembers([]); setPendingRequests([]); setIsCreator(false); setMyCliqueInfo(null); return }
    fetch(`/api/cliques/${myCliqueId}`)
      .then(r => r.json())
      .then(d => {
        setMyMembers(d.members ?? [])
        setPendingRequests(d.pending ?? [])
        setIsCreator(!!d.is_creator)
        setPowWow(!!d.pow_wow)
        if (d.clique) setMyCliqueInfo({ name: d.clique.name, gym_id: d.clique.gym_id, city: d.gym?.city_name, state: d.gym?.state })
      })
      .catch(() => {})
  }, [myCliqueId])

  // Pow-Wow: creator opens the clique to everyone (start) / closes it (end)
  async function powWowAction(action: 'start' | 'end') {
    if (!myCliqueId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${myCliqueId}/powwow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        showToastMsg(action === 'start' ? '🪶 Pow-Wow started — everyone can join!' : '🪶 Pow-Wow ended')
        loadMyClique()
      } else {
        const d = await res.json()
        showToastMsg(`❌ ${d.error || 'Failed'}`)
      }
    } catch {}
    setBusy(false)
  }

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

  async function leaveClique() {
    if (!myCliqueId) return
    setBusy(true)
    try {
      await fetch('/api/cliques/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clique_id: myCliqueId }),
      })
      showToastMsg('👋 Left the clique')
      setMyCliqueId(null)
      await Promise.all([loadCliques(), refetch()])
    } catch {}
    setBusy(false)
  }

  async function setDefault(cliqueId: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/cliques/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clique_id: cliqueId }),
      })
      if (res.ok) {
        setMyDefaultId(cliqueId)
        showToastMsg('⭐ Default clique updated')
        await Promise.all([loadCliques(), refetch()])
      }
    } catch {}
    setBusy(false)
  }

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  // dropdown list: default clique first, then the rest
  const orderedCliques = [
    ...myCliques.filter(m => m.id === myDefaultId),
    ...myCliques.filter(m => m.id !== myDefaultId),
  ]
  const openClique = myCliques.find(m => m.id === myCliqueId)

  return (
    <div className="min-h-screen bg-gray-950 pb-6 flex flex-col">
      {/* Header — title + the clique dropdown right next to it */}
      <div className="px-4 pt-8 pb-4"
        style={{ background: `linear-gradient(180deg, ${partyColor}26 0%, transparent 100%)` }}>
        <div className="flex items-center gap-3">
          <h1 className="text-white font-black text-2xl">✊ Cliques</h1>
          {myCliques.length > 0 && (
            <div className="relative">
              <button onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition text-white"
                style={{ borderColor: `${partyColor}88`, background: `${partyColor}22` }}>
                <span className="max-w-[140px] truncate">
                  {(openClique ?? orderedCliques[0])?.name.split(' — ')[0] ?? 'My cliques'}
                </span>
                <span className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {menuOpen && (
                <>
                  {/* click-away layer */}
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute left-0 top-full mt-1.5 z-50 min-w-[220px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
                    {orderedCliques.map(m => (
                      <button key={m.id}
                        onClick={() => { setMyCliqueId(m.id); setMenuOpen(false) }}
                        className={`w-full text-left px-3.5 py-2.5 text-sm font-bold transition hover:bg-gray-800 ${
                          m.id === myCliqueId ? 'text-white' : 'text-gray-300'}`}
                        style={m.id === myCliqueId ? { background: `${partyColor}22` } : undefined}>
                        {m.id === myDefaultId ? '⭐ ' : ''}{m.name.split(' — ')[0]}
                      </button>
                    ))}
                    <button onClick={() => { setMenuOpen(false); router.push('/cliques/browse') }}
                      className="w-full text-left px-3.5 py-2.5 text-sm font-bold text-purple-400 hover:bg-gray-800 border-t border-gray-800 transition">
                      🔍 More cliques
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-gray-400 text-sm mt-1">
          {partyName} cliques — band together around a town hall
        </p>
      </div>

      {/* Not in any clique yet → send them to the Active Cliques page */}
      {!loading && myCliques.length === 0 && (
        <div className="mx-4 bg-gray-900 rounded-2xl border border-gray-800 p-6 text-center">
          <p className="text-white font-bold">You&apos;re not in a clique yet</p>
          <p className="text-gray-500 text-sm mt-1">Find one anywhere in the country — or start your own.</p>
          <button onClick={() => router.push('/cliques/browse')}
            className="mt-4 px-6 py-2.5 rounded-xl font-bold text-white transition active:scale-95"
            style={{ background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)` }}>
            🔍 Find a clique
          </button>
        </div>
      )}

      {/* The open clique's panel */}
      {myCliqueId && (
        <div className="mx-4 mb-4 bg-gray-900 rounded-2xl border p-4" style={{ borderColor: `${partyColor}66` }}>
          {(() => {
            const nm = myCliqueInfo?.name ?? '...'
            const sep = nm.lastIndexOf(' — ')
            const cliqueName = sep >= 0 ? nm.slice(0, sep) : nm
            const townName = myCliqueInfo?.city ?? (sep >= 0 ? nm.slice(sep + 3) : null)
            const gymId = myCliqueInfo?.gym_id
            return (
              <>
                {/* the clique name, with its town hall as a tappable link */}
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <h2 className="text-white font-black text-lg truncate">{cliqueName}</h2>
                    {townName && gymId && (
                      <button
                        onClick={() => router.push(`/townhall/${gymId}`)}
                        className="text-xs font-medium hover:opacity-80 transition flex items-center gap-1"
                        style={{ color: partyColor }}>
                        🏛️ {townName}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                    {myCliqueId === myDefaultId ? (
                      <span className="text-xs font-bold text-yellow-400">⭐ Default</span>
                    ) : (
                      <button onClick={() => myCliqueId && setDefault(myCliqueId)} disabled={busy}
                        className="text-xs text-gray-500 hover:text-yellow-300 transition disabled:opacity-50">
                        ☆ Make default
                      </button>
                    )}
                    <button onClick={leaveClique} disabled={busy}
                      className="text-xs text-gray-500 hover:text-red-400 transition disabled:opacity-50">
                      Leave
                    </button>
                  </div>
                </div>
                {/* Tap to expand/collapse the member roster */}
                <button onClick={() => setShowMembers(v => !v)} className="text-left w-full mb-2 flex items-center justify-between">
                  <p className="text-gray-500 text-xs">
                    {myMembers.length} member{myMembers.length !== 1 ? 's' : ''}{isCreator ? ' · you are the creator' : ''} · tap to {showMembers ? 'hide' : 'see'} members
                  </p>
                  <span className={`text-gray-500 text-xs transition-transform ${showMembers ? 'rotate-180' : ''}`}>▼</span>
                </button>

                {/* Pow-Wow — creator opens the doors; banner shows while live */}
                {powWow && (
                  <div className="mb-3 rounded-xl border border-amber-600/60 bg-amber-900/20 px-3 py-2.5 flex items-center gap-2.5">
                    <span className="text-xl">🪶</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-amber-300 text-xs font-bold">Pow-Wow LIVE — the clique is open to everyone</p>
                    </div>
                    {isCreator && (
                      <button onClick={() => powWowAction('end')} disabled={busy}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-700 text-white hover:bg-amber-600 transition disabled:opacity-50">
                        End it
                      </button>
                    )}
                  </div>
                )}
                {isCreator && !powWow && (
                  <button onClick={() => powWowAction('start')} disabled={busy}
                    className="w-full mb-3 py-2 rounded-xl text-xs font-bold border border-amber-700/60 bg-amber-900/15 text-amber-300 hover:bg-amber-900/30 transition disabled:opacity-50">
                    🪶 Start a Pow-Wow — open the clique to everyone
                  </button>
                )}
              </>
            )
          })()}

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
                    <span className="text-gray-300 text-sm flex-1 truncate">
                      {m.username}
                      {m.pow_wow_guest && (
                        <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/50">
                          🪶 guest
                        </span>
                      )}
                    </span>
                    <span className="text-gray-600 text-xs">⚔️ {m.total_battles_won}</span>
                  </button>
                  {isCreator && !m.pow_wow_guest && m.id !== profile?.id && (
                    <button onClick={() => manageMember(m.id, 'remove')} disabled={busy}
                      className="text-gray-700 hover:text-red-400 text-xs transition disabled:opacity-50" title="Remove from clique">✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clique chat — stretches down to the bottom nav (Michael) */}
      {myCliqueId && (
        <div className="mx-4 mb-2 flex-1 flex flex-col">
          <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2">💬 Clique Chat</h3>
          <CliqueFeed cliqueId={myCliqueId} partyColor={partyColor} isCreator={isCreator} stretch />
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

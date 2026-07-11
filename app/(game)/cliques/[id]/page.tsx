'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Settings, Image as ImageIcon, X } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { BANNERS } from '@/config/banners'

interface Member { id: string; username: string; avatar_url: string | null; total_battles_won: number }
interface Pending { id: string; username: string; avatar_url: string | null }
interface Post {
  id: string; profile_id: string; content: string | null; image_url: string | null
  created_at: string; username: string; avatar_url: string | null; is_mine: boolean
}
interface Clique {
  id: string; name: string; party: 'democrat' | 'republican'; gym_id: string | null
  creator_id: string; join_policy: 'open' | 'request'; banner_url: string | null
}

export default function CliquePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { profile } = useProfile()

  const [clique, setClique] = useState<Clique | null>(null)
  const [gym, setGym] = useState<{ city_name: string; state: string } | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [isMember, setIsMember] = useState(false)
  const [isCreator, setIsCreator] = useState(false)
  const [memberCount, setMemberCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [posts, setPosts] = useState<Post[]>([])
  const [draft, setDraft] = useState('')
  const [draftImage, setDraftImage] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState(false)
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const load = useCallback(async () => {
    const res = await fetch(`/api/cliques/${params.id}`)
    const d = await res.json()
    if (!res.ok) { showToast(`❌ ${d.error || 'Not found'}`); setLoading(false); return }
    setClique(d.clique); setGym(d.gym); setMembers(d.members ?? []); setPending(d.pending ?? [])
    setIsMember(d.is_member); setIsCreator(d.is_creator); setMemberCount(d.member_count ?? 0)
    setLoading(false)
    if (d.is_member) {
      const pr = await fetch(`/api/cliques/${params.id}/posts`)
      const pd = await pr.json()
      if (pr.ok) setPosts(pd.posts ?? [])
    }
  }, [params.id])

  useEffect(() => { load() }, [load])

  async function pickImage(file: File) {
    if (file.size > 6 * 1024 * 1024) { showToast('❌ Image too large (6 MB max)'); return }
    // Downscale in the browser so uploads stay small
    const bmp = await createImageBitmap(file)
    const max = 1000
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    setDraftImage(canvas.toDataURL('image/webp', 0.85))
  }

  async function submitPost() {
    if (posting || (!draft.trim() && !draftImage)) return
    setPosting(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim(), image: draftImage }),
      })
      const d = await res.json()
      if (!res.ok) { showToast(`❌ ${d.error || 'Post failed'}`); return }
      setPosts(p => [d.post, ...p])
      setDraft(''); setDraftImage(null)
    } catch { showToast('❌ Post failed') }
    finally { setPosting(false) }
  }

  async function deletePost(id: string) {
    const res = await fetch(`/api/cliques/${params.id}/posts?post=${id}`, { method: 'DELETE' })
    if (res.ok) setPosts(p => p.filter(x => x.id !== id))
  }

  async function saveSettings(updates: { join_policy?: string; banner_url?: string | null }) {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const d = await res.json()
      if (!res.ok) { showToast(`❌ ${d.error || 'Save failed'}`); return }
      setClique(c => c ? { ...c, ...d.clique } : c)
      if (updates.join_policy === 'open') { showToast('🚪 Clique is now open — pending requests admitted'); load() }
      else if (updates.join_policy) showToast('🔒 Now request-only')
      else showToast('🖼️ Banner updated')
    } catch { showToast('❌ Save failed') }
    finally { setBusy(false) }
  }

  // Same-party visitors can join (or request) right from this page
  async function joinClique() {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/join`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) { showToast(`❌ ${d.error || 'Could not join'}`); return }
      if (d.status === 'member') { showToast('🎉 Welcome to the clique!'); load() }
      else { setRequested(true); showToast('📨 Request sent — waiting for approval') }
    } catch { showToast('❌ Could not join') }
    finally { setBusy(false) }
  }

  async function manageMember(profileId: string, action: 'approve' | 'deny' | 'remove') {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, action }),
      })
      if (!res.ok) { const d = await res.json(); showToast(`❌ ${d.error || 'Failed'}`); return }
      load()
    } catch { showToast('❌ Failed') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading clique...</p></div>
  if (!clique) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <p className="text-gray-400">Clique not found.</p>
      <button onClick={() => router.push('/cliques')} className="text-blue-400 text-sm">← Back to Cliques</button>
    </div>
  )

  const partyColor = clique.party === 'democrat' ? '#2563eb' : '#dc2626'
  const sameParty = profile?.party === clique.party

  return (
    <div className="min-h-screen bg-gray-950 pb-8">
      {/* Banner */}
      <div className="relative h-40" style={{
        background: clique.banner_url
          ? `linear-gradient(180deg, rgba(3,7,18,0.15), rgba(3,7,18,0.92)), url(${clique.banner_url}) center/cover`
          : `linear-gradient(135deg, ${partyColor}, ${partyColor}44)`,
      }}>
        <button onClick={() => router.push('/cliques')}
          className="absolute top-4 left-4 bg-black/50 rounded-full p-2 text-white">
          <ArrowLeft size={16} />
        </button>
        {isCreator && (
          <button onClick={() => setShowSettings(s => !s)}
            className="absolute top-4 right-4 bg-black/50 rounded-full p-2 text-white">
            <Settings size={16} />
          </button>
        )}
        <div className="absolute bottom-3 left-4 right-4">
          <h1 className="text-white font-black text-xl drop-shadow">{clique.name}</h1>
          <p className="text-gray-300 text-xs">
            {sameParty
              ? <>
                  {memberCount} member{memberCount !== 1 ? 's' : ''}
                  {gym ? <> · <span role="link" onClick={() => clique.gym_id && router.push(`/townhall/${clique.gym_id}`)}
                    className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-white">{gym.city_name}, {gym.state}</span></> : null}
                  {' · '}{clique.join_policy === 'open' ? '🚪 Open to all' : '🔒 Request to join'}
                </>
              : gym
                ? <span role="link" onClick={() => clique.gym_id && router.push(`/townhall/${clique.gym_id}`)}
                    className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-white">{gym.city_name}, {gym.state}</span>
                : `${clique.party === 'democrat' ? 'Democrat' : 'Republican'} clique`}
          </p>
        </div>
      </div>

      {/* Creator settings */}
      {isCreator && showSettings && (
        <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-4 space-y-4">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Who can join?</p>
            <div className="flex gap-2">
              {(['open', 'request'] as const).map(p => (
                <button key={p} onClick={() => saveSettings({ join_policy: p })} disabled={busy}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${clique.join_policy === p ? 'text-white' : 'text-gray-400 bg-gray-800'}`}
                  style={clique.join_policy === p ? { background: partyColor } : undefined}>
                  {p === 'open' ? '🚪 Anyone can join' : '🔒 Approve requests'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Banner</p>
            <div className="grid grid-cols-2 gap-2">
              {BANNERS.map(b => (
                <button key={b.id} onClick={() => saveSettings({ banner_url: b.url })} disabled={busy}
                  className="rounded-lg overflow-hidden border-2 transition"
                  style={{ borderColor: clique.banner_url === b.url ? partyColor : '#1f2937' }}>
                  <img src={b.url} alt={b.name} className="h-14 w-full object-cover" />
                  <p className="text-[10px] text-gray-400 py-1">{b.name}</p>
                </button>
              ))}
            </div>
            <button onClick={() => saveSettings({ banner_url: null })} disabled={busy}
              className="w-full mt-2 py-2 bg-gray-800 text-gray-400 rounded-lg text-xs font-bold">
              Use party color
            </button>
          </div>
        </div>
      )}

      {/* Join requests (creator, request-only) */}
      {isCreator && pending.length > 0 && (
        <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs font-bold mb-2">📨 Join Requests ({pending.length})</p>
          {pending.map(p => (
            <div key={p.id} className="flex items-center gap-2 py-1.5">
              <span className="text-white text-sm flex-1 truncate">{p.username}</span>
              <button onClick={() => manageMember(p.id, 'approve')} disabled={busy}
                className="text-xs font-bold px-2 py-1 rounded bg-green-600 text-white">✓</button>
              <button onClick={() => manageMember(p.id, 'deny')} disabled={busy}
                className="text-xs font-bold px-2 py-1 rounded bg-gray-700 text-gray-300">✕</button>
            </div>
          ))}
        </div>
      )}

      {!isMember ? (
        sameParty ? (
          // Same party: they can join (or request) right here
          <div className="mx-4 mt-6 text-center">
            <div className="text-5xl mb-3">🔒</div>
            <p className="text-gray-400 text-sm">This clique&apos;s feed is members-only.</p>
            {profile?.clique_id ? (
              <p className="text-gray-600 text-xs mt-1">Leave your current clique first to join this one.</p>
            ) : requested ? (
              <p className="text-yellow-400 text-sm font-bold mt-3">📨 Request sent — waiting for approval</p>
            ) : (
              <button onClick={joinClique} disabled={busy}
                className="mt-4 px-8 py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50"
                style={{ background: partyColor }}>
                {clique.join_policy === 'open' ? '✊ Join Clique' : '📨 Request to Join'}
              </button>
            )}
          </div>
        ) : (
          // Rival party: name + town only (more visible to rivals later)
          <div className="mx-4 mt-6 text-center">
            <div className="text-5xl mb-3">✊</div>
            <p className="text-gray-400 text-sm">
              A {clique.party === 'democrat' ? 'Democrat' : 'Republican'} clique{gym ? ` out of ${gym.city_name}, ${gym.state}` : ''}.
            </p>
            <p className="text-gray-600 text-xs mt-1">Rival cliques keep their business to themselves.</p>
          </div>
        )
      ) : (
        <>
          {/* Composer */}
          <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-3">
            <textarea value={draft} onChange={e => setDraft(e.target.value)}
              placeholder="Post to your clique..." rows={2} maxLength={800}
              className="w-full bg-transparent text-white text-sm placeholder-gray-600 resize-none outline-none" />
            {draftImage && (
              <div className="relative mt-2">
                <img src={draftImage} alt="" className="rounded-lg max-h-52 w-full object-cover" />
                <button onClick={() => setDraftImage(null)}
                  className="absolute top-2 right-2 bg-black/70 rounded-full p-1 text-white"><X size={14} /></button>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <input ref={fileRef} type="file" accept="image/*" hidden
                onChange={e => e.target.files?.[0] && pickImage(e.target.files[0])} />
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-gray-400 text-xs font-bold px-2 py-1.5 rounded-lg bg-gray-800">
                <ImageIcon size={14} /> Meme
              </button>
              <span className="text-gray-700 text-[10px] flex-1">{draft.length}/800</span>
              <button onClick={submitPost} disabled={posting || (!draft.trim() && !draftImage)}
                className="text-xs font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40"
                style={{ background: partyColor }}>
                {posting ? '...' : 'Post'}
              </button>
            </div>
          </div>

          {/* Feed */}
          <div className="mx-4 mt-3 space-y-2">
            {posts.length === 0 && (
              <p className="text-gray-600 text-xs text-center py-8">No posts yet — say something.</p>
            )}
            {posts.map(p => (
              <div key={p.id} className="bg-gray-900 rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                    : <div className="w-6 h-6 rounded-full" style={{ background: partyColor }} />}
                  <span className="text-white text-xs font-bold">{p.username}</span>
                  <span className="text-gray-600 text-[10px] flex-1">
                    {new Date(p.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {(p.is_mine || isCreator) && (
                    <button onClick={() => deletePost(p.id)} className="text-gray-600 hover:text-red-400"><X size={13} /></button>
                  )}
                </div>
                {p.content && <p className="text-gray-200 text-sm whitespace-pre-wrap break-words">{p.content}</p>}
                {p.image_url && <img src={p.image_url} alt="" className="rounded-xl mt-2 w-full object-cover max-h-96" />}
              </div>
            ))}
          </div>

          {/* Members */}
          <div className="mx-4 mt-4 bg-gray-900 rounded-2xl p-4">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Members</p>
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5">
                {m.avatar_url
                  ? <img src={m.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                  : <div className="w-7 h-7 rounded-full" style={{ background: partyColor }} />}
                <button onClick={() => router.push(`/player/${m.id}`)} className="text-white text-sm flex-1 text-left truncate">
                  {m.username}{m.id === clique.creator_id ? ' 👑' : ''}
                </button>
                <span className="text-gray-600 text-xs">{m.total_battles_won}W</span>
                {isCreator && m.id !== profile?.id && (
                  <button onClick={() => manageMember(m.id, 'remove')} disabled={busy}
                    className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center border border-gray-700">{toast}</div>
        </div>
      )}
    </div>
  )
}

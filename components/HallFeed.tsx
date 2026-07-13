'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon, X, MessageCircle, Share, ArrowBigUp, ArrowBigDown, Flag, MapPin, Trash2 } from 'lucide-react'

// Town hall discussion feed — looks like X, votes like Reddit.
// Tapping a post opens /townhall/[gymId]/post/[postId] with the reply thread.

export interface HallPost {
  id: string
  profile_id: string
  content: string | null
  image_url: string | null
  link_url: string | null
  link_title: string | null
  link_image: string | null
  link_domain: string | null
  score: number
  comment_count: number
  created_at: string
  username: string
  avatar_url: string | null
  party: 'democrat' | 'republican' | null
  my_vote: number
  is_mine: boolean
  nsfw?: boolean
  local?: boolean
}

export function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

export function partyColor(party: string | null): string {
  return party === 'democrat' ? '#2563eb' : party === 'republican' ? '#dc2626' : '#6b7280'
}

// ▲ score ▼ — Reddit-style pill. Optimistic; the server response settles it.
export function VoteButtons({ score, myVote, onVote, compact }: {
  score: number
  myVote: number
  onVote: (v: number) => void
  compact?: boolean
}) {
  return (
    <div className={`flex items-center rounded-full bg-gray-800/80 ${compact ? 'gap-0' : 'gap-0.5'}`}
      onClick={e => e.stopPropagation()}>
      <button onClick={() => onVote(myVote === 1 ? 0 : 1)}
        className={`p-1.5 rounded-full transition ${myVote === 1 ? 'text-orange-400' : 'text-gray-500 hover:text-gray-300'}`}>
        <ArrowBigUp size={compact ? 16 : 19} fill={myVote === 1 ? 'currentColor' : 'none'} />
      </button>
      <span className={`font-bold tabular-nums min-w-[1.4rem] text-center ${compact ? 'text-[11px]' : 'text-xs'} ${
        myVote === 1 ? 'text-orange-400' : myVote === -1 ? 'text-indigo-400' : 'text-gray-300'
      }`}>{score}</span>
      <button onClick={() => onVote(myVote === -1 ? 0 : -1)}
        className={`p-1.5 rounded-full transition ${myVote === -1 ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'}`}>
        <ArrowBigDown size={compact ? 16 : 19} fill={myVote === -1 ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

export function LinkCard({ post }: { post: { link_url: string | null; link_title: string | null; link_image: string | null; link_domain: string | null } }) {
  if (!post.link_url) return null
  return (
    <a href={post.link_url} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className="block mt-2 rounded-xl overflow-hidden border border-gray-800 bg-gray-900/60 hover:bg-gray-800/60 transition">
      {post.link_image && (
        <img src={post.link_image} alt="" className="w-full max-h-52 object-cover" />
      )}
      <div className="px-3 py-2">
        <p className="text-gray-500 text-[10px] uppercase">{post.link_domain}</p>
        {post.link_title && <p className="text-gray-200 text-xs font-medium line-clamp-2">{post.link_title}</p>}
      </div>
    </a>
  )
}

// Community report — one per player per target; 3 reports auto-hide a post
export async function reportTarget(targetType: string, targetId: string, reportedProfileId?: string) {
  try {
    await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: targetType, target_id: targetId, reported_profile_id: reportedProfileId }),
    })
  } catch {}
}

export function sharePost(gymId: string, post: { id: string; content: string | null }) {
  const url = `${window.location.origin}/townhall/${gymId}/post/${post.id}`
  if (navigator.share) {
    navigator.share({ title: 'PoliticsGo', text: post.content?.slice(0, 100) ?? 'Check out this post', url }).catch(() => {})
  } else {
    navigator.clipboard?.writeText(url)
  }
}

export default function HallFeed({ gymId }: { gymId: string }) {
  const router = useRouter()
  const [posts, setPosts] = useState<HallPost[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftImage, setDraftImage] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [shared, setShared] = useState('')
  const [reported, setReported] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<'top' | 'local' | 'new'>('top')
  const [markLocal, setMarkLocal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoaded(false)
    fetch(`/api/gyms/${gymId}/posts?sort=${sort}`)
      .then(r => r.json())
      .then(d => setPosts(d.posts ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [gymId, sort])

  async function pickImage(file: File) {
    if (file.size > 6 * 1024 * 1024) return
    const bmp = await createImageBitmap(file)
    const max = 1200
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    setDraftImage(canvas.toDataURL('image/webp', 0.85))
  }

  async function submit() {
    if (posting || (!draft.trim() && !draftImage)) return
    setPosting(true)
    try {
      const res = await fetch(`/api/gyms/${gymId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim(), image: draftImage, local: markLocal }),
      })
      const d = await res.json()
      if (res.ok) { setPosts(p => [d.post, ...p]); setDraft(''); setDraftImage(null); setMarkLocal(false) }
    } catch {}
    setPosting(false)
  }

  async function vote(post: HallPost, v: number) {
    // optimistic
    setPosts(ps => ps.map(p => p.id === post.id ? { ...p, score: p.score + v - p.my_vote, my_vote: v } : p))
    try {
      const res = await fetch(`/api/hall-posts/${post.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: v }),
      })
      const d = await res.json()
      if (res.ok) setPosts(ps => ps.map(p => p.id === post.id ? { ...p, score: d.score, my_vote: d.my_vote } : p))
    } catch {}
  }

  function share(post: HallPost) {
    sharePost(gymId, post)
    setShared(post.id)
    setTimeout(() => setShared(''), 1500)
  }

  async function deletePost(post: HallPost) {
    if (!post.is_mine || !confirm('Delete this post?')) return
    setPosts(ps => ps.filter(p => p.id !== post.id))
    fetch(`/api/hall-posts/${post.id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div>
      {/* Composer */}
      <div className="bg-gray-900 rounded-2xl p-3 mb-1">
        <textarea value={draft} onChange={e => setDraft(e.target.value)}
          placeholder="What's happening at this hall?" rows={2} maxLength={1000}
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
            <ImageIcon size={14} /> Photo
          </button>
          {/* Mark as local — surfaces the post in this hall's Local tab */}
          <button onClick={() => setMarkLocal(v => !v)}
            title="Mark this post as local — shows in the Local tab"
            className={`flex items-center gap-1 text-xs font-bold px-2 py-1.5 rounded-lg transition ${
              markLocal ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>
            <MapPin size={14} /> Local
          </button>
          <span className="text-gray-700 text-[10px] flex-1 hidden sm:block">Links get a preview automatically</span>
          <button onClick={submit} disabled={posting || (!draft.trim() && !draftImage)}
            className="text-xs font-bold px-4 py-1.5 rounded-lg text-white bg-blue-600 disabled:opacity-40">
            {posting ? '...' : 'Post'}
          </button>
        </div>
      </div>

      {/* Sort tabs: Top (24h, default) | Local (48h, ranked) | Latest */}
      <div className="flex gap-2 mt-2 mb-1">
        {([
          { key: 'top' as const, label: '🔥 Top' },
          { key: 'local' as const, label: '📍 Local' },
          { key: 'new' as const, label: '🕐 Latest' },
        ]).map(t => (
          <button key={t.key}
            onClick={() => setSort(t.key)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition ${
              sort === t.key ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300 border border-gray-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Feed — X-style flat cards divided by hairlines */}
      {!loaded ? (
        <p className="text-gray-600 text-xs text-center py-8">Loading the conversation...</p>
      ) : posts.length === 0 ? (
        <p className="text-gray-600 text-xs text-center py-8">
          {sort === 'local'
            ? 'No local posts in the last 48 hours — tap 📍 Local when you post to start.'
            : 'Nothing posted here yet — start the conversation.'}
        </p>
      ) : (
        <div className="divide-y divide-gray-800/80">
          {posts.map(p => (
            <article key={p.id}
              onClick={() => router.push(`/townhall/${gymId}/post/${p.id}`)}
              className="py-3 px-1 cursor-pointer hover:bg-gray-900/40 transition rounded-lg">
              <div className="flex gap-2.5">
                {p.avatar_url
                  ? <img src={p.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border"
                      style={{ borderColor: partyColor(p.party) }} />
                  : <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm border"
                      style={{ borderColor: partyColor(p.party), background: `${partyColor(p.party)}22` }}>
                      {p.party === 'democrat' ? '🔵' : p.party === 'republican' ? '🔴' : '⚪'}
                    </div>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-white font-bold truncate">{p.username}</span>
                    <span className="text-gray-600">· {timeAgo(p.created_at)}</span>
                    {p.local && (
                      <span className="flex items-center gap-0.5 text-emerald-400 text-[10px] font-bold flex-shrink-0">
                        <MapPin size={10} /> Local
                      </span>
                    )}
                  </div>
                  {p.content && (
                    <p className="text-gray-200 text-sm whitespace-pre-wrap break-words mt-0.5">{p.content}</p>
                  )}
                  {p.image_url && (
                    <img src={p.image_url} alt="" className="rounded-xl mt-2 w-full object-cover max-h-80 border border-gray-800" />
                  )}
                  <LinkCard post={p} />
                  {/* Action row */}
                  <div className="flex items-center gap-4 mt-2">
                    <VoteButtons compact score={p.score} myVote={p.my_vote} onVote={v => vote(p, v)} />
                    <button className="flex items-center gap-1 text-gray-500 hover:text-blue-400 transition"
                      onClick={e => { e.stopPropagation(); router.push(`/townhall/${gymId}/post/${p.id}`) }}>
                      <MessageCircle size={15} />
                      <span className="text-[11px] font-bold">{p.comment_count}</span>
                    </button>
                    <button className="flex items-center gap-1 text-gray-500 hover:text-green-400 transition"
                      onClick={e => { e.stopPropagation(); share(p) }}>
                      <Share size={14} />
                      <span className="text-[11px] font-bold">{shared === p.id ? 'Copied!' : 'Share'}</span>
                    </button>
                    {!p.is_mine && (
                      <button className={`flex items-center gap-1 transition ${reported.has(p.id) ? 'text-orange-400' : 'text-gray-600 hover:text-orange-400'}`}
                        onClick={e => {
                          e.stopPropagation()
                          if (reported.has(p.id)) return
                          reportTarget('hall_post', p.id, p.profile_id)
                          setReported(prev => new Set(prev).add(p.id))
                        }}>
                        <Flag size={13} />
                        <span className="text-[11px] font-bold">{reported.has(p.id) ? 'Reported' : ''}</span>
                      </button>
                    )}
                    {p.is_mine && (
                      <button className="flex items-center gap-1 text-gray-600 hover:text-red-400 transition"
                        onClick={e => { e.stopPropagation(); deletePost(p) }} title="Delete post">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

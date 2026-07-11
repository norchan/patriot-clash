'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, MessageCircle, Share, Trash2, Flag } from 'lucide-react'
import { VoteButtons, LinkCard, sharePost, reportTarget, timeAgo, partyColor, type HallPost } from '@/components/HallFeed'

interface HallComment {
  id: string
  parent_id: string | null
  profile_id: string
  content: string
  score: number
  created_at: string
  username: string
  avatar_url: string | null
  party: 'democrat' | 'republican' | null
  my_vote: number
  is_mine: boolean
}

// Full-page post view: the post on top, replies below — top-level replies
// sorted by score (most upvoted first), nested replies underneath their
// parents, Reddit style.
export default function HallPostPage() {
  const router = useRouter()
  const params = useParams()
  const gymId = params.id as string
  const postId = params.postId as string

  const [post, setPost] = useState<HallPost | null>(null)
  const [comments, setComments] = useState<HallComment[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<HallComment | null>(null)
  const [posting, setPosting] = useState(false)
  const [shared, setShared] = useState(false)
  const [reportedPost, setReportedPost] = useState(false)
  const [reportedComments, setReportedComments] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`/api/hall-posts/${postId}`)
      .then(r => r.json())
      .then(d => {
        if (d.post) { setPost(d.post); setComments(d.comments ?? []) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [postId])

  async function votePost(v: number) {
    if (!post) return
    setPost({ ...post, score: post.score + v - post.my_vote, my_vote: v })
    try {
      const res = await fetch(`/api/hall-posts/${postId}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: v }),
      })
      const d = await res.json()
      if (res.ok) setPost(p => p ? { ...p, score: d.score, my_vote: d.my_vote } : p)
    } catch {}
  }

  async function voteComment(c: HallComment, v: number) {
    setComments(cs => cs.map(x => x.id === c.id ? { ...x, score: x.score + v - x.my_vote, my_vote: v } : x))
    try {
      const res = await fetch(`/api/hall-comments/${c.id}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: v }),
      })
      const d = await res.json()
      if (res.ok) setComments(cs => cs.map(x => x.id === c.id ? { ...x, score: d.score, my_vote: d.my_vote } : x))
    } catch {}
  }

  async function submitComment() {
    const text = draft.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      const res = await fetch(`/api/hall-posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, parent_id: replyTo?.id ?? null }),
      })
      const d = await res.json()
      if (res.ok) {
        setComments(cs => [...cs, d.comment])
        setPost(p => p ? { ...p, comment_count: p.comment_count + 1 } : p)
        setDraft('')
        setReplyTo(null)
      }
    } catch {}
    setPosting(false)
  }

  async function deletePost() {
    if (!post?.is_mine) return
    await fetch(`/api/hall-posts/${postId}`, { method: 'DELETE' }).catch(() => {})
    router.push(`/townhall/${gymId}`)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-500 text-sm">Loading post...</p>
    </div>
  )

  if (!post) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <p className="text-gray-400">Post not found.</p>
      <button onClick={() => router.back()} className="mt-4 text-blue-400">← Back</button>
    </div>
  )

  // Top-level comments by score desc (ties: oldest first); replies nested
  // under their parents, also by score
  const topLevel = comments.filter(c => !c.parent_id).sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at))
  const childrenOf = (id: string) =>
    comments.filter(c => c.parent_id === id).sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at))

  const Comment = ({ c, depth }: { c: HallComment; depth: number }) => (
    <div className={depth > 0 ? 'ml-6 pl-3 border-l border-gray-800' : ''}>
      <div className="py-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          {c.avatar_url
            ? <img src={c.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
            : <span className="text-[10px]">{c.party === 'democrat' ? '🔵' : c.party === 'republican' ? '🔴' : '⚪'}</span>}
          <button onClick={() => router.push(`/player/${c.profile_id}`)} className="text-white font-bold hover:underline">
            {c.username}
          </button>
          <span className="text-gray-600">· {timeAgo(c.created_at)}</span>
        </div>
        <p className="text-gray-200 text-sm whitespace-pre-wrap break-words mt-1">{c.content}</p>
        <div className="flex items-center gap-3 mt-1.5">
          <VoteButtons compact score={c.score} myVote={c.my_vote} onVote={v => voteComment(c, v)} />
          <button onClick={() => { setReplyTo(c); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }}
            className="text-gray-500 hover:text-blue-400 text-[11px] font-bold transition">
            Reply
          </button>
          {!c.is_mine && (
            <button
              onClick={() => {
                if (reportedComments.has(c.id)) return
                reportTarget('hall_comment', c.id, c.profile_id)
                setReportedComments(prev => new Set(prev).add(c.id))
              }}
              className={`text-[11px] font-bold transition ${reportedComments.has(c.id) ? 'text-orange-400' : 'text-gray-600 hover:text-orange-400'}`}>
              {reportedComments.has(c.id) ? 'Reported' : <Flag size={12} />}
            </button>
          )}
        </div>
      </div>
      {childrenOf(c.id).map(child => <Comment key={child.id} c={child} depth={depth + 1} />)}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-36">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="text-white font-bold text-sm">Post</h1>
        {post.is_mine && (
          <button onClick={deletePost} className="ml-auto text-gray-600 hover:text-red-400"><Trash2 size={16} /></button>
        )}
      </div>

      {/* The post */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          {post.avatar_url
            ? <img src={post.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border"
                style={{ borderColor: partyColor(post.party) }} />
            : <div className="w-10 h-10 rounded-full flex items-center justify-center border"
                style={{ borderColor: partyColor(post.party), background: `${partyColor(post.party)}22` }}>
                {post.party === 'democrat' ? '🔵' : post.party === 'republican' ? '🔴' : '⚪'}
              </div>}
          <div>
            <button onClick={() => router.push(`/player/${post.profile_id}`)}
              className="text-white font-bold text-sm hover:underline block">{post.username}</button>
            <span className="text-gray-600 text-xs">{timeAgo(post.created_at)} ago</span>
          </div>
        </div>
        {post.content && (
          <p className="text-gray-100 text-[15px] whitespace-pre-wrap break-words mt-3">{post.content}</p>
        )}
        {post.image_url && (
          <img src={post.image_url} alt="" className="rounded-xl mt-3 w-full object-contain max-h-[28rem] border border-gray-800" />
        )}
        <LinkCard post={post} />
        <div className="flex items-center gap-5 mt-3">
          <VoteButtons score={post.score} myVote={post.my_vote} onVote={votePost} />
          <span className="flex items-center gap-1 text-gray-500">
            <MessageCircle size={16} /><span className="text-xs font-bold">{post.comment_count}</span>
          </span>
          <button onClick={() => { sharePost(gymId, post); setShared(true); setTimeout(() => setShared(false), 1500) }}
            className="flex items-center gap-1 text-gray-500 hover:text-green-400 transition">
            <Share size={15} /><span className="text-xs font-bold">{shared ? 'Copied!' : 'Share'}</span>
          </button>
          {!post.is_mine && (
            <button
              onClick={() => {
                if (reportedPost) return
                reportTarget('hall_post', post.id, post.profile_id)
                setReportedPost(true)
              }}
              className={`flex items-center gap-1 transition ${reportedPost ? 'text-orange-400' : 'text-gray-600 hover:text-orange-400'}`}>
              <Flag size={14} /><span className="text-xs font-bold">{reportedPost ? 'Reported' : 'Report'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Replies — most upvoted first */}
      <div className="px-4">
        {topLevel.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-8">No replies yet — be the first.</p>
        ) : (
          <div className="divide-y divide-gray-900">
            {topLevel.map(c => <Comment key={c.id} c={c} depth={0} />)}
          </div>
        )}
      </div>

      {/* Reply composer — fixed above the bottom nav */}
      <div className="fixed bottom-20 left-0 right-0 max-w-md mx-auto px-3 z-30">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-2 shadow-2xl">
          {replyTo && (
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-blue-400 text-[11px] font-bold">↪ Replying to {replyTo.username}</span>
              <button onClick={() => setReplyTo(null)} className="text-gray-500 text-xs">✕</button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitComment()}
              placeholder={replyTo ? `Reply to ${replyTo.username}...` : 'Join the conversation...'}
              maxLength={800}
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-600 border border-transparent focus:border-blue-700 transition"
            />
            <button onClick={submitComment} disabled={posting || !draft.trim()}
              className="px-4 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded-xl font-bold transition">
              Reply
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

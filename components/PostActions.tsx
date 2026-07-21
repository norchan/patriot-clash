'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { ArrowBigUp, ArrowBigDown, MessageCircle, Share, Flag } from 'lucide-react'

// The one true action row — identical on every post and reply, everywhere:
// comment · upvote/score/downvote · share · report. Guests get bounced to
// sign-up for votes and reports; share works for everyone.

export default function PostActions({ kind, id, postId, score, commentCount }: {
  kind: 'post' | 'comment'
  id: string
  postId: string // the post page this belongs to (== id for posts)
  score: number
  commentCount?: number
}) {
  const router = useRouter()
  const { isSignedIn: signedIn } = useUser()
  const [myVote, setMyVote] = useState(0)
  const [shared, setShared] = useState(false)
  const [reported, setReported] = useState(false)

  async function vote(dir: 1 | -1) {
    if (!signedIn) { router.push('/sign-up'); return }
    const next = myVote === dir ? 0 : dir
    setMyVote(next)
    const url = kind === 'post' ? `/api/hall-posts/${id}/vote` : `/api/hall-comments/${id}/vote`
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: next }),
      })
    } catch { /* optimistic */ }
  }

  async function share(e: React.MouseEvent) {
    e.stopPropagation()
    const url = `${window.location.origin}/p/post/${postId}`
    try {
      if (navigator.share) await navigator.share({ title: 'PoliticsGo', url })
      else { await navigator.clipboard.writeText(url); setShared(true); setTimeout(() => setShared(false), 1500) }
    } catch { /* user closed the share sheet */ }
  }

  async function report(e: React.MouseEvent) {
    e.stopPropagation()
    if (!signedIn) { router.push('/sign-up'); return }
    if (reported || !confirm('Report this to the moderators?')) return
    setReported(true)
    fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: kind === 'post' ? 'hall_post' : 'hall_comment', target_id: id }),
    }).catch(() => {})
  }

  return (
    <div className="mt-1.5 flex items-center justify-between max-w-[320px] text-gray-500 text-[12px]"
      onClick={e => e.stopPropagation()}>
      <button onClick={() => router.push(`/p/post/${postId}#reply`)}
        className="flex items-center gap-1.5 hover:text-blue-400 transition p-1" aria-label="Reply">
        <MessageCircle size={16} /> {typeof commentCount === 'number' && commentCount > 0 && commentCount}
      </button>
      <span className="flex items-center">
        <button onClick={() => vote(1)} aria-label="Upvote"
          className={`p-1 ${myVote === 1 ? 'text-orange-400' : 'hover:text-orange-300'}`}>
          <ArrowBigUp size={18} fill={myVote === 1 ? 'currentColor' : 'none'} />
        </button>
        <span className="font-bold tabular-nums min-w-[1.2rem] text-center text-gray-400">{score + myVote}</span>
        <button onClick={() => vote(-1)} aria-label="Downvote"
          className={`p-1 ${myVote === -1 ? 'text-blue-400' : 'hover:text-blue-300'}`}>
          <ArrowBigDown size={18} fill={myVote === -1 ? 'currentColor' : 'none'} />
        </button>
      </span>
      <button onClick={share} className={`p-1 transition ${shared ? 'text-green-400' : 'hover:text-green-300'}`} aria-label="Share">
        <Share size={15} />
      </button>
      <button onClick={report} className={`p-1 transition ${reported ? 'text-red-500' : 'hover:text-red-400'}`} aria-label="Report">
        <Flag size={15} fill={reported ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

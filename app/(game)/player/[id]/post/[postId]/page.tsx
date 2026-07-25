'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

interface Profile {
  id: string
  username: string
  avatar_url: string | null
  party: string | null
}

interface Comment {
  id: string
  profile_id: string
  parent_comment_id: string | null
  content: string
  score: number
  created_at: string
  profiles: Profile
}

interface Post {
  id: string
  profile_id: string
  content: string
  media_url: string | null
  media_type: 'image' | 'video' | null
  score: number
  created_at: string
  profile: Profile
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function CommentThread({ comment, allComments, postId, viewer, isFriend, isOwner, onReplyClick }: any) {
  const [myVote, setMyVote] = useState(0)
  const [score, setScore] = useState(comment.score)
  const [replying, setReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [posting, setPosting] = useState(false)

  const replies = allComments.filter((c: Comment) => c.parent_comment_id === comment.id)

  async function vote(v: number) {
    if (!viewer) return
    const newVote = myVote === v ? 0 : v
    setMyVote(newVote)
    const delta = newVote - myVote
    setScore(score + delta)

    try {
      const res = await fetch(`/api/posts/${postId}/comments/${comment.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: newVote }),
      })
      if (!res.ok) {
        setMyVote(myVote)
        setScore(score)
      }
    } catch {
      setMyVote(myVote)
      setScore(score)
    }
  }

  async function postReply() {
    if (!replyText.trim() || posting) return
    setPosting(true)
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText, parentCommentId: comment.id }),
      })
      if (res.ok) {
        setReplyText('')
        setReplying(false)
        window.location.reload()
      }
    } catch {}
    setPosting(false)
  }

  return (
    <div key={comment.id} className="border-l-2 border-gray-800 pl-4 py-3">
      <div className="flex items-center gap-2">
        {comment.profiles.avatar_url && (
          <img src={comment.profiles.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
        )}
        <span className="text-sm font-bold text-white">{comment.profiles.username}</span>
        <span className="text-xs text-gray-500">{timeAgo(comment.created_at)}</span>
      </div>
      <p className="text-gray-200 text-sm mt-2 whitespace-pre-wrap">{comment.content}</p>
      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => vote(1)} className={`p-1 rounded transition ${myVote === 1 ? 'text-green-400' : 'text-gray-500 hover:text-green-400'}`}>
            <ThumbsUp size={14} />
          </button>
          <span className="text-xs text-gray-400">{score}</span>
          <button onClick={() => vote(-1)} className={`p-1 rounded transition ${myVote === -1 ? 'text-red-400' : 'text-gray-500 hover:text-red-400'}`}>
            <ThumbsDown size={14} />
          </button>
        </div>
        {(isFriend || isOwner) && (
          <button onClick={() => setReplying(!replying)} className="text-xs text-purple-400 hover:text-purple-300">
            Reply
          </button>
        )}
      </div>
      {replying && (
        <div className="mt-2">
          <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 outline-none focus:border-gray-600"
            rows={2} />
          <div className="flex gap-2 mt-1">
            <button onClick={postReply} disabled={posting || !replyText.trim()}
              className="px-3 py-1 bg-purple-700 text-white text-xs font-bold rounded hover:bg-purple-600 disabled:opacity-50">
              {posting ? '...' : 'Reply'}
            </button>
            <button onClick={() => setReplying(false)} className="px-3 py-1 bg-gray-800 text-gray-300 text-xs rounded hover:bg-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}
      {replies.length > 0 && (
        <div className="mt-3 space-y-2">
          {replies.map((reply: Comment) => (
            <CommentThread key={reply.id} comment={reply} allComments={allComments} postId={postId} viewer={viewer} isFriend={isFriend} isOwner={isOwner} onReplyClick={onReplyClick} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function PostDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { profile: viewer } = useProfile()
  const [post, setPost] = useState<Post | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [isFriend, setIsFriend] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)

  const postId = params.postId as string
  const playerId = params.id as string

  useEffect(() => {
    if (!postId) return
    fetch(`/api/posts/${postId}`)
      .then(r => r.json())
      .then(d => {
        setPost(d.post)
        setComments(d.comments || [])
        if (viewer && d.post.profile_id === viewer.id) setIsOwner(true)
        // Check friendship
        if (viewer && d.post.profile_id !== viewer.id) {
          fetch(`/api/friends?with=${d.post.profile_id}`)
            .then(r => r.json())
            .then(f => setIsFriend(f.status === 'friends'))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [postId, viewer?.id])

  async function postComment() {
    if (!newComment.trim() || posting) return
    setPosting(true)
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment }),
      })
      if (res.ok) {
        setNewComment('')
        window.location.reload()
      }
    } catch {}
    setPosting(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400">Loading...</div>
    </div>
  )

  if (!post) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <p className="text-gray-400 mb-4">Post not found</p>
      <button onClick={() => router.back()} className="text-blue-400">← Back</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-4 hover:text-white">
          <ArrowLeft size={16} /> Back
        </button>

        {/* Post */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            {post.profile.avatar_url && (
              <img src={post.profile.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
            )}
            <div>
              <p className="text-white font-bold">{post.profile.username}</p>
              <p className="text-gray-500 text-xs">{timeAgo(post.created_at)}</p>
            </div>
          </div>
          <p className="text-gray-200 whitespace-pre-wrap mb-3">{post.content}</p>
          {post.media_type === 'image' && post.media_url && (
            <img src={post.media_url} alt="" className="rounded-xl max-h-96 w-full object-cover mb-3" />
          )}
          {post.media_type === 'video' && post.media_url && (
            <video src={post.media_url} controls className="rounded-xl max-h-96 w-full mb-3" />
          )}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">{post.score}</span>
              <span className="text-xs text-gray-500">reactions</span>
            </div>
            <span className="text-xs text-gray-500">{comments.length} comments</span>
          </div>
        </div>

        {/* Comment form */}
        {viewer && (isOwner || isFriend) && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
            <textarea value={newComment} onChange={e => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-gray-600 resize-none" rows={3} />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setNewComment('')} className="px-4 py-2 text-gray-300 text-sm rounded-lg hover:bg-gray-800">Cancel</button>
              <button onClick={postComment} disabled={posting || !newComment.trim()}
                className="px-4 py-2 bg-purple-700 text-white text-sm font-bold rounded-lg hover:bg-purple-600 disabled:opacity-50">
                {posting ? '...' : 'Comment'}
              </button>
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="space-y-3">
          {comments.length === 0 ? (
            <p className="text-center text-gray-500 text-sm py-4">No comments yet</p>
          ) : (
            comments.filter(c => !c.parent_comment_id).map(comment => (
              <CommentThread key={comment.id} comment={comment} allComments={comments} postId={postId} viewer={viewer} isFriend={isFriend} isOwner={isOwner} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

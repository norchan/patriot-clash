'use client'
import { useState, useEffect, useRef } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'

interface Post {
  id: string; profile_id: string; content: string | null; image_url: string | null
  created_at: string; username: string; avatar_url: string | null; is_mine: boolean
}

// Members-only clique chat feed (text + meme posts). Reused by the clique
// detail page and the main cliques page for members.
export default function CliqueFeed({ cliqueId, partyColor, isCreator }: {
  cliqueId: string; partyColor: string; isCreator: boolean
}) {
  const [posts, setPosts] = useState<Post[]>([])
  const [draft, setDraft] = useState('')
  const [draftImage, setDraftImage] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/cliques/${cliqueId}/posts`)
      .then(r => r.json())
      .then(d => setPosts(d.posts ?? []))
      .catch(() => {})
  }, [cliqueId])

  async function pickImage(file: File) {
    if (file.size > 6 * 1024 * 1024) return
    const bmp = await createImageBitmap(file)
    const max = 1000
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
      const res = await fetch(`/api/cliques/${cliqueId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim(), image: draftImage }),
      })
      const d = await res.json()
      if (res.ok) { setPosts(p => [d.post, ...p]); setDraft(''); setDraftImage(null) }
    } catch {}
    setPosting(false)
  }

  async function del(id: string) {
    const res = await fetch(`/api/cliques/${cliqueId}/posts?post=${id}`, { method: 'DELETE' })
    if (res.ok) setPosts(p => p.filter(x => x.id !== id))
  }

  return (
    <div>
      {/* Composer */}
      <div className="bg-gray-900 rounded-2xl p-3">
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
          <button onClick={submit} disabled={posting || (!draft.trim() && !draftImage)}
            className="text-xs font-bold px-4 py-1.5 rounded-lg text-white disabled:opacity-40"
            style={{ background: partyColor }}>
            {posting ? '...' : 'Post'}
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="mt-3 space-y-2">
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
                <button onClick={() => del(p.id)} className="text-gray-600 hover:text-red-400"><X size={13} /></button>
              )}
            </div>
            {p.content && <p className="text-gray-200 text-sm whitespace-pre-wrap break-words">{p.content}</p>}
            {p.image_url && <img src={p.image_url} alt="" className="rounded-xl mt-2 w-full object-cover max-h-96" />}
          </div>
        ))}
      </div>
    </div>
  )
}

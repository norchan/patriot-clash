'use client'
import { useState, useEffect, useRef } from 'react'
import { Image as ImageIcon, X, Send } from 'lucide-react'

interface Msg {
  id: string; profile_id: string; content: string | null; image_url: string | null
  created_at: string; username: string; avatar_url: string | null; is_mine: boolean
}

// Twitch-style username colors — seeded by name so everyone sees the same one
const CHAT_COLORS = ['#ff6b6b', '#f59e0b', '#22c55e', '#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#e879f9', '#60a5fa']
function nameColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0
  return CHAT_COLORS[Math.abs(h) % CHAT_COLORS.length]
}

// Members-only LIVE CHAT (Kick/Twitch style): a streaming feed of compact
// lines, newest at the bottom, polled every 3s. Replaces the old post feed.
export default function CliqueFeed({ cliqueId, partyColor, isCreator }: {
  cliqueId: string; partyColor: string; isCreator: boolean
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [draftImage, setDraftImage] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)

  useEffect(() => {
    const poll = () => {
      fetch(`/api/cliques/${cliqueId}/posts`)
        .then(r => r.json())
        .then(d => { if (d.posts) setMsgs([...d.posts].reverse()) }) // ascending: oldest → newest
        .catch(() => {})
    }
    poll()
    const iv = setInterval(poll, 3000)
    return () => clearInterval(iv)
  }, [cliqueId])

  useEffect(() => {
    if (stickBottom.current) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
  }, [msgs])

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

  async function send() {
    if (posting || (!draft.trim() && !draftImage)) return
    setPosting(true)
    try {
      const res = await fetch(`/api/cliques/${cliqueId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim(), image: draftImage }),
      })
      const d = await res.json()
      if (res.ok) {
        setMsgs(p => [...p, d.post])
        setDraft(''); setDraftImage(null)
        stickBottom.current = true
      }
    } catch {}
    setPosting(false)
  }

  async function del(id: string) {
    const res = await fetch(`/api/cliques/${cliqueId}/posts?post=${id}`, { method: 'DELETE' })
    if (res.ok) setMsgs(p => p.filter(x => x.id !== id))
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden flex flex-col" style={{ height: 460 }}>
      {/* header */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-white text-xs font-bold uppercase tracking-wider">Clique Chat</span>
        <span className="text-gray-600 text-[10px] ml-auto">{msgs.length} messages</span>
      </div>

      {/* stream */}
      <div ref={boxRef}
        onScroll={() => {
          const el = boxRef.current
          if (el) stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {msgs.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-10">Dead chat 💀 — say something.</p>
        ) : msgs.map(m => (
          <div key={m.id} className="group text-sm leading-snug break-words">
            <span className="align-middle">
              {m.avatar_url && (
                <img src={m.avatar_url} alt="" className="inline w-4.5 h-4.5 w-[18px] h-[18px] rounded-full object-cover mr-1.5 align-text-bottom" />
              )}
              <span className="font-bold" style={{ color: m.is_mine ? partyColor : nameColor(m.username) }}>
                {m.username}
              </span>
              {m.content && <span className="text-gray-200">: {m.content}</span>}
            </span>
            {m.image_url && (
              <img src={m.image_url} alt="" className="block rounded-lg mt-1 max-h-40 max-w-[70%] object-cover border border-gray-800" />
            )}
            {(m.is_mine || isCreator) && (
              <button onClick={() => del(m.id)}
                className="ml-1.5 text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition align-middle">
                <X size={11} className="inline" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* composer */}
      {draftImage && (
        <div className="px-3 pt-2 flex-shrink-0">
          <div className="relative inline-block">
            <img src={draftImage} alt="" className="h-16 rounded-lg object-cover border border-gray-700" />
            <button onClick={() => setDraftImage(null)}
              className="absolute -top-1.5 -right-1.5 bg-gray-800 border border-gray-600 rounded-full p-0.5 text-white"><X size={10} /></button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 p-2 border-t border-gray-800 flex-shrink-0">
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={e => { e.target.files?.[0] && pickImage(e.target.files[0]); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()}
          className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition flex-shrink-0">
          <ImageIcon size={15} />
        </button>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Send a message..."
          maxLength={800}
          className="flex-1 min-w-0 bg-gray-800 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder-gray-600 border border-transparent transition"
          style={{ borderColor: draft ? `${partyColor}66` : undefined }}
        />
        <button onClick={send} disabled={posting || (!draft.trim() && !draftImage)}
          className="p-2 rounded-lg text-white disabled:opacity-40 transition flex-shrink-0"
          style={{ background: partyColor }}>
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}

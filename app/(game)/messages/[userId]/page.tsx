'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Camera, Image as ImageIcon, X, MapPin } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import AlbumViewer from '@/components/AlbumViewer'

interface Msg { id: string; sender_id: string; content: string | null; image_url: string | null; created_at: string }

// Shrink photos for sending; GIFs pass through untouched (canvas would
// freeze the animation) as long as they fit the size cap.
function prepareImage(file: File): Promise<string | null> {
  return new Promise(resolve => {
    if (file.type === 'image/gif') {
      if (file.size > 3.5 * 1024 * 1024) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
      return
    }
    createImageBitmap(file).then(bmp => {
      const max = 1280
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scale)
      canvas.height = Math.round(bmp.height * scale)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/webp', 0.85))
    }).catch(() => resolve(null))
  })
}

export default function MessageThreadPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.userId as string
  const { profile } = useProfile()

  const [other, setOther] = useState<{ username: string; avatar_url: string | null; party: string | null } | null>(null)
  const [otherLoc, setOtherLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [draftImage, setDraftImage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [viewer, setViewer] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  // Who am I talking to
  useEffect(() => {
    fetch(`/api/players/${userId}/profile`)
      .then(r => r.json())
      .then(d => {
        if (d.profile) setOther({ username: d.profile.username, avatar_url: d.profile.avatar_url, party: d.profile.party })
        if (d.location) setOtherLoc({ lat: d.location.lat, lng: d.location.lng })
      })
      .catch(() => {})
  }, [userId])

  // Poll the thread
  useEffect(() => {
    const poll = () => {
      fetch(`/api/chat/${userId}`)
        .then(r => r.json())
        .then(d => { if (d.messages) setMessages(d.messages) })
        .catch(() => {})
    }
    poll()
    const iv = setInterval(poll, 3000)
    return () => clearInterval(iv)
  }, [userId])

  // Stay pinned to the newest message unless the user scrolled up
  useEffect(() => {
    if (stickBottom.current) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
  }, [messages])

  async function pickFile(file: File) {
    const dataUrl = await prepareImage(file)
    if (dataUrl) setDraftImage(dataUrl)
  }

  async function send() {
    const content = input.trim()
    if ((!content && !draftImage) || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/chat/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, image: draftImage }),
      })
      const data = await res.json()
      if (res.ok && data.message) {
        setMessages(prev => [...prev, data.message])
        setInput('')
        setDraftImage(null)
        stickBottom.current = true
      } else if (data.error) {
        alert(data.error)
      }
    } catch {}
    setSending(false)
  }

  const color = other?.party === 'democrat' ? '#2563eb' : other?.party === 'republican' ? '#dc2626' : '#6b7280'

  return (
    <div className="bg-gray-950 flex flex-col" style={{ height: 'calc(100dvh - 5rem)' }}>
      {/* Header — tap the player to open their profile */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white">
          <ArrowLeft size={18} />
        </button>
        <button onClick={() => router.push(`/player/${userId}`)} className="flex items-center gap-2.5 min-w-0">
          {other?.avatar_url ? (
            <img src={other.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border-2" style={{ borderColor: color }} />
          ) : (
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-base border-2"
              style={{ borderColor: color, background: `${color}22` }}>
              {other?.party === 'democrat' ? '🔵' : other?.party === 'republican' ? '🔴' : '⚪'}
            </div>
          )}
          <span className="text-white font-bold text-sm truncate">{other?.username ?? '...'}</span>
        </button>
        {otherLoc && (
          <button onClick={() => router.push(`/map?flat=${otherLoc.lat}&flng=${otherLoc.lng}`)}
            className="ml-auto flex items-center gap-1 text-xs font-bold text-blue-400 hover:text-blue-300 transition flex-shrink-0"
            title="View on map">
            <MapPin size={14} /> View on map
          </button>
        )}
      </div>

      {/* Thread */}
      <div ref={boxRef}
        onScroll={() => {
          const el = boxRef.current
          if (el) stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">
            No messages yet — say hi to {other?.username ?? 'them'}! 👋
          </p>
        ) : messages.map(m => {
          const isMe = m.sender_id === profile?.id
          return (
            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[78%] rounded-2xl text-sm text-white break-words overflow-hidden"
                style={{
                  background: isMe ? '#1d4ed8' : '#1f2937',
                  borderBottomRightRadius: isMe ? 6 : undefined,
                  borderBottomLeftRadius: isMe ? undefined : 6,
                }}>
                {m.image_url && (
                  <img src={m.image_url} alt="" loading="lazy"
                    onClick={() => setViewer(m.image_url)}
                    className="w-full max-h-72 object-cover cursor-pointer" />
                )}
                <div className={m.image_url && !m.content ? 'px-2 pb-1' : 'px-3 py-2'}>
                  {m.content}
                  <div className={`text-[9px] mt-0.5 ${isMe ? 'text-blue-300/70 text-right' : 'text-gray-500'}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Composer */}
      <div className="p-3 border-t border-gray-800 flex-shrink-0">
        {draftImage && (
          <div className="relative inline-block mb-2">
            <img src={draftImage} alt="" className="h-24 rounded-xl object-cover border border-gray-700" />
            <button onClick={() => setDraftImage(null)}
              className="absolute -top-2 -right-2 bg-gray-800 border border-gray-600 rounded-full p-1 text-white">
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex gap-2 items-center">
          {/* Camera: opens the device camera directly on phones */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
            onChange={e => { e.target.files?.[0] && pickFile(e.target.files[0]); e.target.value = '' }} />
          <button onClick={() => cameraRef.current?.click()}
            className="p-2.5 rounded-xl bg-gray-800 text-gray-300 hover:text-white transition flex-shrink-0" title="Take a photo">
            <Camera size={18} />
          </button>
          {/* Gallery: photos + GIFs */}
          <input ref={galleryRef} type="file" accept="image/*" hidden
            onChange={e => { e.target.files?.[0] && pickFile(e.target.files[0]); e.target.value = '' }} />
          <button onClick={() => galleryRef.current?.click()}
            className="p-2.5 rounded-xl bg-gray-800 text-gray-300 hover:text-white transition flex-shrink-0" title="Send a picture or GIF">
            <ImageIcon size={18} />
          </button>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder={draftImage ? 'Add a caption...' : 'Type a message...'}
            maxLength={500}
            className="flex-1 min-w-0 bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 outline-none placeholder-gray-600 border border-transparent focus:border-blue-700 transition"
          />
          <button onClick={send} disabled={sending || (!input.trim() && !draftImage)}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded-xl font-bold transition flex-shrink-0">
            Send
          </button>
        </div>
      </div>

      {/* Fullscreen image viewer */}
      {viewer && (
        <AlbumViewer photos={[{ id: 'img', url: viewer }]} title={other?.username} onClose={() => setViewer(null)} />
      )}
    </div>
  )
}

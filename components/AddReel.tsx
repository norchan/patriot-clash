'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Link2, Upload, Video, Square, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

// ADD A REEL (Michael): three ways in —
//  🔗 Link  — paste a YouTube Shorts / TikTok URL (embeds, house gates apply)
//  ⬆️ Upload — pick a video file, streamed straight to storage
//  🎥 Record — camera + mic right in the browser (phone or computer), 60s cap
// Uploads/recordings are the player's OWN footage — we host those; the
// embed-only rule is about other platforms' content.

const MAX_BYTES = 50 * 1024 * 1024 // 50MB — a 60s phone reel fits comfortably
const EXT_OK: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }

export default function AddReel() {
  const router = useRouter()
  const [mode, setMode] = useState<'link' | 'upload' | 'record'>('link')
  const [caption, setCaption] = useState('')
  const [link, setLink] = useState('')
  const [file, setFile] = useState<File | Blob | null>(null)
  const [fileExt, setFileExt] = useState('mp4')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')

  // ── recording (getUserMedia + MediaRecorder) ─────────────────────────────
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { // leave page → camera off, blobs released
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startCamera() {
    setErr('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        await videoRef.current.play().catch(() => {})
      }
    } catch {
      setErr('Camera blocked — allow camera access, or use Upload instead')
    }
  }

  function startRecording() {
    const stream = streamRef.current
    if (!stream) return
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm'
      : 'video/mp4'
    const rec = new MediaRecorder(stream, { mimeType: mime })
    recorderRef.current = rec
    chunksRef.current = []
    rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime.split(';')[0] })
      setFile(blob)
      setFileExt(mime.startsWith('video/webm') ? 'webm' : 'mp4')
      const url = URL.createObjectURL(blob)
      setPreviewUrl(url)
      stream.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    rec.start()
    setRecording(true)
    setRecSecs(0)
    recTimerRef.current = setInterval(() => setRecSecs(s => {
      if (s + 1 >= 60) stopRecording() // reels cap at 60s
      return s + 1
    }), 1000)
  }

  function stopRecording() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    recorderRef.current?.stop()
    setRecording(false)
  }

  function pickFile(f: File | null) {
    setErr('')
    if (!f) return
    const ext = EXT_OK[f.type]
    if (!ext) { setErr('mp4, webm or mov videos only'); return }
    if (f.size > MAX_BYTES) { setErr('Keep it under 50MB (about a minute of phone video)'); return }
    setFile(f)
    setFileExt(ext)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
  }

  // ── submit paths ─────────────────────────────────────────────────────────
  async function submitLink() {
    const url = link.trim()
    if (!/^https?:\/\/\S+/.test(url)) { setErr('Paste a YouTube Shorts or TikTok link'); return }
    setBusy(true); setErr(''); setProgress('Checking the video…')
    try {
      const res = await fetch('/api/boards/videos/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: caption.trim(), link_url: url }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Could not post'); return }
      router.push(`/reels?start=${d.post.id}`)
    } catch { setErr('Could not post — try again') } finally { setBusy(false); setProgress('') }
  }

  async function submitFile() {
    if (!file) { setErr('Pick, record or upload a video first'); return }
    setBusy(true); setErr('')
    try {
      setProgress('Reserving an upload slot…')
      const slotRes = await fetch('/api/reels/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext: fileExt }),
      })
      const slot = await slotRes.json()
      if (!slotRes.ok) { setErr(slot.error ?? 'Upload failed'); return }
      setProgress('Uploading your reel…')
      const supabase = createSupabaseBrowserClient()
      const { error: upErr } = await supabase.storage.from('avatars')
        .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type || 'video/mp4' })
      if (upErr) { setErr('Upload failed — try again'); return }
      setProgress('Publishing…')
      const postRes = await fetch('/api/reels/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: slot.path, caption: caption.trim() }),
      })
      const d = await postRes.json()
      if (!postRes.ok) { setErr(d.error ?? 'Could not publish'); return }
      router.push(`/reels?start=${d.post_id}`)
    } catch { setErr('Something broke mid-upload — try again') } finally { setBusy(false); setProgress('') }
  }

  const tabs = [
    { key: 'link' as const, label: '🔗 Link' },
    { key: 'upload' as const, label: '⬆️ Upload' },
    { key: 'record' as const, label: '🎥 Record' },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-16">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/reels')} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="text-white font-black text-lg">🎬 Add a Reel</h1>
        </div>

        <div className="mt-4 flex gap-1.5">
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setMode(t.key); setErr(''); if (t.key === 'record' && !streamRef.current && !previewUrl) startCamera() }}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black transition ${
                mode === t.key ? 'bg-purple-700 text-white' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* caption — shared by all three paths */}
        <input value={caption} onChange={e => setCaption(e.target.value)} maxLength={200}
          placeholder="Caption (optional)…"
          className="mt-4 w-full px-4 py-3 bg-gray-900 rounded-2xl border border-gray-800 text-white text-sm placeholder-gray-600 outline-none focus:border-purple-600" />

        {mode === 'link' && (
          <div className="mt-4">
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 rounded-2xl border border-gray-800 focus-within:border-purple-600">
              <Link2 size={15} className="text-gray-600 shrink-0" />
              <input value={link} onChange={e => setLink(e.target.value)} inputMode="url"
                placeholder="YouTube Shorts or TikTok link…"
                className="w-full bg-transparent text-blue-300 text-sm placeholder-gray-600 outline-none" />
            </div>
            <p className="text-gray-600 text-[11px] mt-2 px-1">Dead or non-embeddable videos are rejected automatically.</p>
            <button onClick={submitLink} disabled={busy}
              className="mt-4 w-full py-3.5 rounded-2xl font-black text-white transition active:scale-[0.98] disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              {busy ? progress || 'Posting…' : 'Post the reel'}
            </button>
          </div>
        )}

        {mode === 'upload' && (
          <div className="mt-4">
            {!previewUrl ? (
              <label className="block w-full rounded-2xl border-2 border-dashed border-gray-700 bg-gray-900/60 py-10 text-center cursor-pointer hover:border-purple-600 transition">
                <Upload size={22} className="mx-auto text-gray-500" />
                <span className="block mt-2 text-sm font-bold text-gray-300">Tap to pick a video</span>
                <span className="block text-[11px] text-gray-600 mt-1">mp4 / webm / mov · up to 50MB (~1 min)</span>
                <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden"
                  onChange={e => pickFile(e.target.files?.[0] ?? null)} />
              </label>
            ) : (
              <div className="rounded-2xl overflow-hidden border border-gray-700 bg-black">
                <video src={previewUrl} controls playsInline className="w-full max-h-[50vh]" />
                <button onClick={() => { setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }}
                  className="w-full py-2 text-xs font-bold text-gray-400 hover:text-white bg-gray-900">✕ Choose a different video</button>
              </div>
            )}
            <button onClick={submitFile} disabled={busy || !file}
              className="mt-4 w-full py-3.5 rounded-2xl font-black text-white transition active:scale-[0.98] disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              {busy ? progress || 'Uploading…' : 'Upload & post'}
            </button>
          </div>
        )}

        {mode === 'record' && (
          <div className="mt-4">
            <div className="relative rounded-2xl overflow-hidden border border-gray-700 bg-black" style={{ aspectRatio: '9 / 16', maxHeight: '55vh' }}>
              {previewUrl ? (
                <video src={previewUrl} controls playsInline className="w-full h-full object-contain" />
              ) : (
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              )}
              {recording && (
                <span className="absolute top-3 left-3 flex items-center gap-1.5 text-xs font-black text-white bg-red-600/90 px-2.5 py-1 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> {recSecs}s / 60s
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              {!previewUrl && !recording && (
                <button onClick={() => (streamRef.current ? startRecording() : startCamera())}
                  className="flex-1 py-3 rounded-2xl font-black text-white text-sm bg-red-600 hover:bg-red-500 active:scale-95 transition flex items-center justify-center gap-2">
                  <Video size={16} /> {streamRef.current ? 'Start recording' : 'Turn on camera'}
                </button>
              )}
              {recording && (
                <button onClick={stopRecording}
                  className="flex-1 py-3 rounded-2xl font-black text-white text-sm bg-gray-700 active:scale-95 transition flex items-center justify-center gap-2">
                  <Square size={14} fill="currentColor" /> Stop
                </button>
              )}
              {previewUrl && (
                <button onClick={() => { setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); startCamera() }}
                  className="px-4 py-3 rounded-2xl font-bold text-gray-300 text-sm bg-gray-800 active:scale-95 transition flex items-center gap-1.5">
                  <X size={14} /> Retake
                </button>
              )}
            </div>
            {previewUrl && (
              <button onClick={submitFile} disabled={busy || !file}
                className="mt-3 w-full py-3.5 rounded-2xl font-black text-white transition active:scale-[0.98] disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                {busy ? progress || 'Uploading…' : 'Post the recording'}
              </button>
            )}
          </div>
        )}

        {err && <p className="text-red-400 text-xs mt-3 px-1">{err}</p>}
        <p className="text-gray-600 text-[11px] text-center mt-4">Reels live in p/videos and the fullscreen swipe feed · 48h life like every post</p>
      </div>
    </div>
  )
}

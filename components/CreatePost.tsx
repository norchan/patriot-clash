'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ImagePlus, Link2, Search, X } from 'lucide-react'

// CREATE A POST (Michael): the full composer page — title, body, a pSub
// picker, up to two photos, and a link field. Paste a URL and the form
// preloads the title and body from the link's preview (og:title /
// og:description) — editable before posting. Submits through the normal
// board post API (moderation, dead-video gate, preview card all included).
// Desk-article sizing (Grok brief 2026-08-24): 8,000-char body + 1-2 stills.

interface BoardOpt { slug: string; name: string; category: string }

const BODY_MAX = 8000

// Downscale a chosen photo to fit the API's 2.5MB base64 gate: longest edge
// 1600px, JPEG, quality stepping down until it fits. PNG/WebP in, JPEG out —
// article stills, not pixel art.
async function fileToDataUrl(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(bmp.width * scale))
    cv.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = cv.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height)
    for (const q of [0.87, 0.75, 0.6]) {
      const url = cv.toDataURL('image/jpeg', q)
      if (url.length < 2.4 * 1024 * 1024) return url
    }
    return null
  } catch { return null }
}

export default function CreatePost({ boards, defaultSlug }: { boards: BoardOpt[]; defaultSlug: string }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [slug, setSlug] = useState(defaultSlug)
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [preview, setPreview] = useState<{ title: string | null; image: string | null; domain: string; description: string | null } | null>(null)
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [stills, setStills] = useState<string[]>([]) // 0-2 data URLs, posted in order
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const prevFor = useRef('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function addStills(files: FileList | null) {
    if (!files) return
    setErr('')
    for (const f of Array.from(files)) {
      if (stills.length >= 2) break
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setErr('Photos only — jpg, png or webp'); continue }
      const url = await fileToDataUrl(f)
      if (!url) { setErr('That image could not be read'); continue }
      setStills(s => (s.length >= 2 ? s : [...s, url]))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  // paste a URL → preload title/body from its preview (only fills what the
  // user hasn't typed — never stomps their words)
  useEffect(() => {
    const url = link.trim()
    if (!/^https?:\/\/\S+\.\S+/i.test(url) || url === prevFor.current) return
    const t = setTimeout(async () => {
      prevFor.current = url
      setLoadingPrev(true)
      try {
        const r = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
        const d = await r.json()
        if (d.preview) {
          setPreview(d.preview)
          if (d.preview.title) setTitle(cur => cur.trim() ? cur : d.preview.title)
          if (d.preview.description) setBody(cur => cur.trim() ? cur : d.preview.description)
        }
      } catch {}
      setLoadingPrev(false)
    }, 600)
    return () => clearTimeout(t)
  }, [link])

  const selected = boards.find(b => b.slug === slug)
  const matches = query.trim().length
    ? boards.filter(b => (`p/${b.slug} ${b.name}`).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : boards.slice(0, 8)

  async function submit() {
    if (busy) return
    setErr('')
    if (!slug) { setErr('Pick a pSub to post in'); return }
    const text = [title.trim(), body.trim()].filter(Boolean).join('\n\n')
    if (!text && !link.trim() && !stills.length) { setErr('Write something, add a photo, or add a link'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/boards/${slug}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          link_url: link.trim() || undefined,
          images: stills.length ? stills : undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Could not post'); return }
      try { sessionStorage.setItem('pg_boards_tab', slug) } catch {}
      router.push(`/p/post/${d.post.id}`)
    } catch {
      setErr('Could not post — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-28">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="text-white font-black text-lg">✏️ Create a post</h1>
        </div>

        {/* pSub picker — search across every postable board */}
        <div className="mt-4">
          <label className="text-gray-400 text-xs uppercase tracking-wider px-1">Posting in</label>
          <button onClick={() => setPickerOpen(o => !o)}
            className="mt-1.5 w-full flex items-center justify-between px-4 py-3 bg-gray-900 rounded-2xl border border-gray-800 hover:border-gray-600 transition">
            <span className="text-white text-sm font-black">p/{slug}{selected && selected.name.toLowerCase() !== slug ? ` · ${selected.name}` : ''}</span>
            <span className="text-gray-500 text-xs font-bold">{pickerOpen ? 'close ▲' : 'change ▼'}</span>
          </button>
          {pickerOpen && (
            <div className="mt-2 rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800">
                <Search size={14} className="text-gray-600 shrink-0" />
                <input value={query} onChange={e => setQuery(e.target.value)} autoFocus
                  placeholder="Search pSubs… (politics, a team, your state)"
                  className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none" />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {matches.map(b => (
                  <button key={b.slug} onClick={() => { setSlug(b.slug); setPickerOpen(false); setQuery('') }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-white/5 transition border-b border-gray-800/50 last:border-0">
                    <span className="text-sm font-bold text-gray-200">p/{b.slug}</span>
                    <span className="text-[10px] text-gray-600 uppercase">{b.category}</span>
                  </button>
                ))}
                {matches.length === 0 && <p className="text-gray-600 text-xs text-center py-3">No pSub matches</p>}
              </div>
            </div>
          )}
        </div>

        {/* title */}
        <div className="mt-4">
          <label className="text-gray-400 text-xs uppercase tracking-wider px-1">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={150}
            placeholder="Give it a headline…"
            className="mt-1.5 w-full px-4 py-3 bg-gray-900 rounded-2xl border border-gray-800 text-white text-sm font-bold placeholder-gray-600 outline-none focus:border-purple-600" />
        </div>

        {/* body — desk-article sized: whole paragraphs, not a caption */}
        <div className="mt-4">
          <label className="text-gray-400 text-xs uppercase tracking-wider px-1 flex items-center justify-between">
            <span>Body</span>
            {body.length > BODY_MAX * 0.75 && (
              <span className={body.length >= BODY_MAX ? 'text-red-400' : 'text-gray-600'}>{body.length.toLocaleString()}/{BODY_MAX.toLocaleString()}</span>
            )}
          </label>
          <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={BODY_MAX} rows={10}
            placeholder="Say your piece… full articles welcome"
            className="mt-1.5 w-full px-4 py-3 bg-gray-900 rounded-2xl border border-gray-800 text-gray-200 text-sm placeholder-gray-600 outline-none focus:border-purple-600 resize-y" />
        </div>

        {/* photos — up to two stills, shown under the body in this order */}
        <div className="mt-4">
          <label className="text-gray-400 text-xs uppercase tracking-wider px-1 flex items-center gap-1.5">
            <ImagePlus size={12} /> Photos (optional, up to 2)
          </label>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
            className="hidden" onChange={e => addStills(e.target.files)} />
          <div className="mt-1.5 flex gap-2">
            {stills.map((s, i) => (
              <div key={i} className="relative w-28 h-28">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s} alt="" className="w-full h-full object-cover rounded-xl border border-gray-700" />
                <button onClick={() => setStills(st => st.filter((_, j) => j !== i))}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-950 border border-gray-600 text-gray-300 flex items-center justify-center hover:text-white">
                  <X size={13} />
                </button>
              </div>
            ))}
            {stills.length < 2 && (
              <button onClick={() => fileRef.current?.click()}
                className="w-28 h-28 rounded-xl border border-dashed border-gray-700 text-gray-600 hover:border-purple-600 hover:text-gray-400 transition flex flex-col items-center justify-center gap-1">
                <ImagePlus size={20} />
                <span className="text-[11px] font-bold">Add photo</span>
              </button>
            )}
          </div>
        </div>

        {/* link */}
        <div className="mt-4">
          <label className="text-gray-400 text-xs uppercase tracking-wider px-1 flex items-center gap-1.5">
            <Link2 size={12} /> Link (optional)
          </label>
          <input value={link} onChange={e => setLink(e.target.value)} inputMode="url"
            placeholder="https://… — the preview fills the title & body for you"
            className="mt-1.5 w-full px-4 py-3 bg-gray-900 rounded-2xl border border-gray-800 text-blue-300 text-sm placeholder-gray-600 outline-none focus:border-purple-600" />
          {loadingPrev && <p className="text-gray-600 text-xs mt-1.5 px-1">Fetching preview…</p>}
          {preview && !loadingPrev && (
            <div className="mt-2 rounded-2xl border border-gray-700/80 overflow-hidden">
              {preview.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.image} alt="" className="w-full max-h-52 object-cover" />
              )}
              <div className="px-3.5 py-2.5 bg-gray-900">
                <p className="text-gray-500 text-[11px]">🔗 {preview.domain}</p>
                {preview.title && <p className="text-gray-200 text-xs font-semibold mt-0.5 line-clamp-2">{preview.title}</p>}
              </div>
            </div>
          )}
        </div>

        {err && <p className="text-red-400 text-xs mt-3 px-1">{err}</p>}
        <button onClick={submit} disabled={busy}
          className="mt-5 w-full py-3.5 rounded-2xl font-black text-white transition active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
          {busy ? 'Posting…' : 'Post it'}
        </button>
        <p className="text-gray-600 text-[11px] text-center mt-2">Links get big preview cards · videos must be playable</p>
      </div>
    </div>
  )
}

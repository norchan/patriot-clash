'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Menu, Plus, LayoutGrid, X } from 'lucide-react'
import PostActions from '@/components/PostActions'

// THE BOARDS DECK — the reddit-app-style psub reader under the battle map.
// ☰ menu + swipeable tab strip (p/all first), active tab underlined; cards
// carry image, pts, comments, age, author and an up/down/star row.

const BASE_TABS = ['all', 'videos', 'politics', 'democrats', 'republicans', 'sports', 'space', 'movies']

interface DeckPost {
  id: string; content: string | null; image_url: string | null
  link_title: string | null; link_domain: string | null
  link_url?: string | null; link_image?: string | null
  score: number; comment_count: number; created_at: string
  party: string | null; username: string; avatar_url?: string | null
  city: string | null; state: string | null
}

const partyColor = (p: string | null) =>
  p === 'democrat' ? '#2563eb' : p === 'republican' ? '#dc2626' : '#6b7280'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 14 * 86400) return `${Math.floor(s / 86400)}d`
  return `${Math.floor(s / (7 * 86400))}w`
}

export default function BoardsDeck({ signedIn, initialPosts, extraTabs = [], swipeNav = false, tall = false }: {
  signedIn: boolean
  initialPosts: DeckPost[]
  extraTabs?: string[] // subscribed psubs — slotted in before p/profile
  swipeNav?: boolean // /boards: swiping the FEED left/right changes psub
  tall?: boolean // /boards: let the feed fill the page
}) {
  const tabs = [...BASE_TABS, ...extraTabs.filter(t => !BASE_TABS.includes(t)), 'profile']
  const router = useRouter()
  const [tab, setTab] = useState('all')
  const [posts, setPosts] = useState<DeckPost[]>(initialPosts)
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [createErr, setCreateErr] = useState('')
  const [creating, setCreating] = useState(false)
  const cache = useRef<Record<string, DeckPost[]>>({ all: initialPosts })

  function openTab(name: string) {
    if (name === 'profile') { router.push(signedIn ? '/profile' : '/sign-up'); return }
    setTab(name); setMenuOpen(false)
    if (cache.current[name]) { setPosts(cache.current[name]); return }
    setLoading(true)
    fetch(`/api/public/boards/${name}`)
      .then(r => r.json())
      .then(d => { cache.current[name] = d.posts ?? []; setPosts(d.posts ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  // /boards: horizontal swipe on the feed jumps to the next/prev psub
  // (p/profile is excluded — swiping should never navigate away)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const swipeTabs = tabs.filter(t => t !== 'profile')
  function onTouchStart(e: React.TouchEvent) {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!swipeNav || !touch.current) return
    const dx = e.changedTouches[0].clientX - touch.current.x
    const dy = e.changedTouches[0].clientY - touch.current.y
    touch.current = null
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return
    const i = swipeTabs.indexOf(tab)
    const next = dx < 0 ? swipeTabs[i + 1] : swipeTabs[i - 1]
    if (next) openTab(next)
  }

  async function createPsub() {
    if (!newName.trim() || creating) return
    setCreating(true); setCreateErr('')
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const d = await res.json()
      if (!res.ok) {
        if (res.status === 409 && d.slug) { router.push(`/p/${d.slug}`); return }
        setCreateErr(d.error ?? 'Could not create psub')
        return
      }
      router.push(`/p/${d.board.slug}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-800 bg-[#1a1f26]">
      {/* top bar: ☰ + tab strip, like the reddit app */}
      <div className="relative flex items-center bg-[#232930] border-b border-black/40">
        <button onClick={() => setMenuOpen(o => !o)} aria-label="Boards menu"
          className="shrink-0 px-3.5 py-3 text-gray-300 hover:text-white">
          <Menu size={20} />
        </button>
        <div className="flex-1 flex overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {tabs.map(name => (
            <button key={name} onClick={() => openTab(name)}
              className={`shrink-0 px-3.5 py-3 text-[13px] font-black transition border-b-2 ${
                tab === name && name !== 'profile'
                  ? 'text-white border-purple-400'
                  : 'text-gray-400 border-transparent hover:text-gray-200'}`}>
              {name === 'profile' ? '👤 p/profile' : `p/${name}`}
            </button>
          ))}
        </div>

        {/* ☰ dropdown */}
        {menuOpen && (
          <div className="absolute left-2 top-full mt-1 z-30 w-56 rounded-2xl border border-gray-700 bg-[#232930] shadow-2xl overflow-hidden">
            <button onClick={() => { setMenuOpen(false); signedIn ? setCreateOpen(true) : router.push('/sign-up') }}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-bold text-gray-200 hover:bg-white/5 text-left">
              <Plus size={16} className="text-purple-400" /> Create a psub
            </button>
            <Link href="/p" onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-bold text-gray-200 hover:bg-white/5 border-t border-black/30">
              <LayoutGrid size={16} className="text-purple-400" /> View all psubs
            </Link>
          </div>
        )}
      </div>

      {/* feed */}
      <div className={`divide-y divide-black/40 overflow-y-auto ${tall ? 'max-h-none' : 'max-h-[70vh]'}`}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loading && <p className="text-gray-500 text-sm text-center py-10">Loading p/{tab}…</p>}
        {!loading && posts.length === 0 && (
          <div className="text-center py-12 px-6">
            <p className="text-gray-500 text-sm">Nothing on p/{tab} yet.</p>
            <Link href={`/p/${tab}`} className="mt-2 inline-block text-purple-400 font-bold text-sm hover:text-purple-300">
              Be the first to post →
            </Link>
          </div>
        )}
        {!loading && posts.map(p => (
          /* X-style card: avatar rail + content, whole card opens the post */
          <article key={p.id}
            onClick={() => router.push(`/p/post/${p.id}`)}
            className="px-4 py-3 flex gap-3 cursor-pointer hover:bg-white/[0.03] transition">
            {p.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatar_url} alt="" loading="lazy"
                className="w-10 h-10 rounded-full object-cover shrink-0 border-2"
                style={{ borderColor: partyColor(p.party) }} />
            ) : (
              <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-black text-white"
                style={{ background: partyColor(p.party) }}>
                {p.username[0]?.toUpperCase() ?? 'P'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px] min-w-0">
                <span className="font-bold text-white truncate">{p.username}</span>
                {p.city && <span className="text-gray-500 truncate">· {p.city}, {p.state}</span>}
                <span className="text-gray-500 shrink-0">· {timeAgo(p.created_at)}</span>
              </div>
              {p.content && (
                <p className="mt-0.5 text-[15px] text-gray-100 leading-snug whitespace-pre-wrap break-words">
                  {p.content}
                </p>
              )}
              {p.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" loading="lazy"
                  className="mt-2 w-full max-h-[380px] object-cover rounded-2xl border border-gray-800" />
              )}
              {/* twitter-style link preview card */}
              {p.link_title && !p.image_url && (
                <div className="mt-2 rounded-2xl border border-gray-800 overflow-hidden">
                  {p.link_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.link_image} alt="" loading="lazy" className="w-full max-h-48 object-cover" />
                  )}
                  <div className="px-3 py-2.5 text-[13px]">
                    <p className="text-gray-600 text-[11px]">{p.link_domain}</p>
                    <p className="text-gray-200 leading-snug mt-0.5">{p.link_title}</p>
                  </div>
                </div>
              )}
              <PostActions kind="post" id={p.id} postId={p.id}
                score={p.score} commentCount={p.comment_count} />
            </div>
          </article>
        ))}
      </div>

      {/* create psub dialog */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(3,7,18,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl p-5 shadow-2xl"
            style={{ background: 'linear-gradient(160deg, #17102b, #0b0716)', border: '1px solid rgba(139,92,246,0.45)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-black text-lg">➕ Create a psub</h3>
              <button onClick={() => setCreateOpen(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-gray-400 text-xs mt-1">Start a board about anything. 3 per day.</p>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createPsub()}
              placeholder="Board name… (e.g. Fishing)" maxLength={42} autoFocus
              className="mt-4 w-full px-4 py-3 rounded-xl bg-black/40 border border-purple-900 text-white text-sm placeholder-gray-600 outline-none focus:border-purple-500" />
            {newName.trim() && (
              <p className="text-gray-500 text-xs mt-1.5">will live at <b className="text-purple-400">p/{newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}</b></p>
            )}
            {createErr && <p className="text-red-400 text-xs mt-2">{createErr}</p>}
            <button onClick={createPsub} disabled={creating || newName.trim().length < 3}
              className="w-full mt-4 py-3 rounded-xl font-black text-white text-sm disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              {creating ? 'Creating…' : 'Create board'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

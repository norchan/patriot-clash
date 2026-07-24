'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X, Play, Plus } from 'lucide-react'

// REELS pager (A1 brief Phases 3-5). v2 architecture is load-bearing: slides
// are plain 100dvh sections in NORMAL document flow with scroll-snap on the
// document root — v1's fixed overlay + inner overflow container blacked out
// video on phones (compositor kills video layers in fixed/overflow/snap
// ancestors). Never wrap these iframes in fixed/transformed/overflow parents.

export interface ReelItem {
  id: string
  kind: 'youtube' | 'tiktok'
  videoId: string
  vertical?: boolean
  thumb?: string
  title?: string | null
  username?: string | null
  party?: string | null
}

// param set kept minimal on purpose — the mobile-verified combo
export function reelSrc(it: ReelItem): string {
  return it.kind === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${it.videoId}?autoplay=1&playsinline=1&rel=0`
    : `https://www.tiktok.com/player/v1/${it.videoId}?autoplay=1`
}

const SEEN_KEY = 'pg_reels_seen'
const HINT_KEY = 'pg_reels_hint_seen'
const PROMPT_KEY = 'pg_reels_signup_prompted'
const partyColor = (p?: string | null) =>
  p === 'democrat' ? '#3b82f6' : p === 'republican' ? '#ef4444' : '#9ca3af'

function readSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') } catch { return [] }
}
function recordSeen(id: string) {
  try {
    const seen = readSeen().filter(s => s !== id)
    seen.push(id)
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-200)))
  } catch {}
}

export function ReelsPager({ items, startId, signedIn = false }: { items: ReelItem[]; startId?: string; signedIn?: boolean }) {
  const router = useRouter()
  // client-side finish of the ranking (A1 Phase 4): the server ordered by
  // recency/score/party; the client demotes clips THIS device already watched
  // (localStorage) — unless the user tapped a specific video (startId), where
  // reordering would break "open at the one I tapped".
  const [ordered, setOrdered] = useState<ReelItem[] | null>(null)
  const [active, setActive] = useState(0)
  const [showHint, setShowHint] = useState(false)
  const [signupNudge, setSignupNudge] = useState(false)
  const maxSwiped = useRef(0)
  const slides = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    if (startId) { setOrdered(items); return }
    const seen = new Set(readSeen())
    const unseen = items.filter(i => !seen.has(i.id))
    const watched = items.filter(i => seen.has(i.id))
    setOrdered([...unseen, ...watched])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // scroll-snap on the DOCUMENT itself (the whole page is the pager) —
  // restored on leave so normal pages scroll normally again
  useEffect(() => {
    const root = document.documentElement
    const prevSnap = root.style.scrollSnapType
    const prevBg = document.body.style.background
    root.style.scrollSnapType = 'y mandatory'
    document.body.style.background = '#000'
    try { if (!localStorage.getItem(HINT_KEY)) { setShowHint(true); localStorage.setItem(HINT_KEY, '1') } } catch {}
    return () => { root.style.scrollSnapType = prevSnap; document.body.style.background = prevBg }
  }, [])

  // open on the tapped video
  const startIndex = ordered ? Math.max(0, ordered.findIndex(it => it.id === startId)) : 0
  useEffect(() => {
    if (!ordered) return
    if (startId && startIndex > 0) slides.current[startIndex]?.scrollIntoView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered])

  // the slide filling the viewport is the one that plays
  useEffect(() => {
    if (!ordered) return
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.idx))
      }
    }, { threshold: 0.6 })
    slides.current.forEach(s => { if (s) io.observe(s) })
    return () => io.disconnect()
  }, [ordered])

  // watch tracking + the SOFT guest nudge (never a wall): after ~10 swiped
  // reels, one dismissible invite per session
  useEffect(() => {
    if (!ordered?.[active]) return
    recordSeen(ordered[active].id)
    maxSwiped.current = Math.max(maxSwiped.current, active)
    if (!signedIn && maxSwiped.current >= 10) {
      try {
        if (!sessionStorage.getItem(PROMPT_KEY)) {
          sessionStorage.setItem(PROMPT_KEY, '1')
          setSignupNudge(true)
        }
      } catch {}
    }
  }, [active, ordered, signedIn])

  if (!ordered) {
    return (
      <div className="bg-black flex items-center justify-center" style={{ height: '100dvh' }}>
        <span className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
      </div>
    )
  }

  return (
    <div className="bg-black">
      {ordered.map((it, i) => (
        <section key={it.id} data-idx={i}
          ref={el => { slides.current[i] = el }}
          className="relative flex items-center justify-center"
          style={{ height: '100dvh', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}>
          {Math.abs(i - active) <= 1 && (
            <>
              {/* thumb always paints first — the swipe never lands on empty black */}
              {it.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.thumb} alt="" className={`absolute object-cover ${it.vertical ? 'h-full aspect-[9/16] max-w-full' : 'w-full aspect-video'}`} />
              )}
              {i === active && (
                // plain iframe in normal flow — the exact conditions the feed's
                // inline players used, which render on every phone
                <iframe src={reelSrc(it)} title={it.title ?? 'Video'}
                  className={`relative ${it.vertical ? 'h-full aspect-[9/16] max-w-full' : 'w-full aspect-video max-h-full'}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen />
              )}
            </>
          )}
          {(it.title || it.username) && i === active && (
            <div className="absolute left-3 right-16 bottom-6 pointer-events-none">
              {it.username && (
                <p className="flex items-center gap-1.5 text-white/80 text-xs font-black">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: partyColor(it.party) }} />
                  @{it.username}
                </p>
              )}
              {it.title && <p className="text-white text-sm font-semibold leading-snug line-clamp-2 mt-0.5"
                style={{ textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>{it.title}</p>}
            </div>
          )}
        </section>
      ))}

      {/* end of the batch: retention CTAs, never a dead end (A1 Phase 5) */}
      <section className="relative flex flex-col items-center justify-center gap-3 px-8 text-center"
        style={{ height: '100dvh', scrollSnapAlign: 'start' }}>
        <p className="text-3xl">🎬</p>
        <p className="text-white font-black text-lg">You&rsquo;re all caught up</p>
        <p className="text-gray-500 text-sm -mt-1 mb-2">Fresh reels drop all day — meanwhile, the war&rsquo;s still on.</p>
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="w-full max-w-xs py-3 rounded-xl font-black text-white text-sm bg-white/10 border border-white/15 active:scale-95 transition">
          🔄 Back to the top
        </button>
        <button onClick={() => router.push(signedIn ? '/map' : '/')}
          className="w-full max-w-xs py-3 rounded-xl font-black text-white text-sm active:scale-95 transition"
          style={{ background: 'linear-gradient(135deg, #dc2626, #7c3aed)' }}>
          ⚔️ Fight on the map
        </button>
        <button onClick={() => router.push('/boards')}
          className="w-full max-w-xs py-3 rounded-xl font-black text-white text-sm bg-white/10 border border-white/15 active:scale-95 transition">
          📰 Hit the boards
        </button>
        {!signedIn && (
          <button onClick={() => router.push('/sign-up')}
            className="w-full max-w-xs py-3 rounded-xl font-black text-white text-sm active:scale-95 transition"
            style={{ background: 'linear-gradient(135deg, #2563eb, #dc2626)' }}>
            🎉 Join the fight — free
          </button>
        )}
      </section>

      {/* chrome */}
      <button onClick={() => (history.length > 1 ? router.back() : router.push('/'))} aria-label="Close"
        className="fixed z-20 w-10 h-10 rounded-full bg-black/60 border border-white/25 flex items-center justify-center text-white active:scale-95"
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top))', right: '0.75rem' }}>
        <X size={20} />
      </button>
      <Link href="/p/videos" aria-label="Add a reel"
        className="fixed z-20 h-10 pl-2.5 pr-3.5 rounded-full bg-black/60 border border-white/25 flex items-center gap-1 text-white text-xs font-black active:scale-95"
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top))', left: '0.75rem' }}>
        <Plus size={16} /> Add a Reel
      </Link>
      {showHint && ordered.length > 1 && active === startIndex && (
        <p className="fixed bottom-2 left-1/2 -translate-x-1/2 z-20 text-white/40 text-[11px] font-bold pointer-events-none">
          swipe up for next ↑
        </p>
      )}

      {/* soft sign-up nudge — dismissible, once per session, never a wall */}
      {signupNudge && (
        <div className="fixed inset-x-4 bottom-6 z-30 max-w-sm mx-auto rounded-3xl border border-purple-500/50 bg-gray-950/95 backdrop-blur p-4 shadow-2xl">
          <p className="text-white font-black text-sm">Enjoying the reels? 🎬</p>
          <p className="text-gray-400 text-xs mt-1">Pick a party, claim your town hall, and fight for the map — free.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => router.push('/sign-up')}
              className="flex-1 py-2.5 rounded-xl font-black text-white text-xs active:scale-95 transition"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
              Create free account
            </button>
            <button onClick={() => setSignupNudge(false)}
              className="px-4 py-2.5 rounded-xl font-bold text-gray-400 text-xs bg-white/5 active:scale-95 transition">
              Keep swiping
            </button>
          </div>
        </div>
      )}

      {ordered.length === 0 && (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
          <p className="text-gray-400 text-sm font-bold">No reels right now — check back soon.</p>
          <Link href="/boards" className="text-purple-400 text-sm font-black">📰 Hit the boards →</Link>
        </div>
      )}
    </div>
  )
}

// Feed-side launcher: big thumbnail card that opens /reels AT this video.
export function ReelCard({ items, index, board = 'videos' }: { items: ReelItem[]; index: number; board?: string }) {
  const it = items[index]
  if (!it) return null
  return (
    <Link href={`/reels?board=${encodeURIComponent(board)}&start=${it.id}`}
      onClick={e => e.stopPropagation()}
      className={`mt-2 relative rounded-2xl overflow-hidden border border-gray-700/80 bg-black block ${it.vertical ? 'max-w-[300px] mx-auto w-full' : 'w-full'}`}
      style={{ aspectRatio: it.vertical ? '9 / 16' : '16 / 9', maxHeight: 540 }}>
      {it.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <span className="w-full h-full flex items-center justify-center text-gray-600 text-xs font-bold">TikTok</span>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-14 h-14 rounded-full bg-black/70 border border-white/40 flex items-center justify-center">
          <Play size={24} className="text-white ml-0.5" fill="currentColor" />
        </span>
      </span>
    </Link>
  )
}

'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X, Play } from 'lucide-react'

// REELS v2 (Michael): fullscreen swipe-up video pager at /reels.
// v1 rendered the pager inside a fixed overlay with its own overflow-auto
// scroll-snap container — desktop rendered fine, but on Michael's phone every
// video was BLACK with audio playing (the classic mobile-compositor failure
// for video layers inside fixed/overflow/snap ancestors). The same embeds
// played fine as plain inline iframes in a normally-scrolling page, so v2 IS
// that: slides in normal document flow, 100dvh each, scroll-snap applied to
// the DOCUMENT root — no fixed wrapper, no overflow container, no transforms
// anywhere above the iframe.

export interface ReelItem {
  id: string
  kind: 'youtube' | 'tiktok'
  videoId: string
  vertical?: boolean
  thumb?: string
  title?: string | null
  username?: string | null
}

// param set kept minimal on purpose — the mobile-verified combo
export function reelSrc(it: ReelItem): string {
  return it.kind === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${it.videoId}?autoplay=1&playsinline=1&rel=0`
    : `https://www.tiktok.com/player/v1/${it.videoId}?autoplay=1`
}

export function ReelsPager({ items, startId }: { items: ReelItem[]; startId?: string }) {
  const router = useRouter()
  const startIndex = Math.max(0, items.findIndex(it => it.id === startId))
  const [active, setActive] = useState(startIndex)
  const slides = useRef<(HTMLElement | null)[]>([])

  // scroll-snap on the DOCUMENT itself (the whole page is the pager) —
  // restored on leave so normal pages scroll normally again
  useEffect(() => {
    const root = document.documentElement
    const prevSnap = root.style.scrollSnapType
    const prevBg = document.body.style.background
    root.style.scrollSnapType = 'y mandatory'
    document.body.style.background = '#000'
    return () => { root.style.scrollSnapType = prevSnap; document.body.style.background = prevBg }
  }, [])

  // open on the tapped video
  useEffect(() => {
    if (startIndex > 0) slides.current[startIndex]?.scrollIntoView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the slide filling the viewport is the one that plays
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.idx))
      }
    }, { threshold: 0.6 })
    slides.current.forEach(s => { if (s) io.observe(s) })
    return () => io.disconnect()
  }, [items.length])

  return (
    <div className="bg-black">
      {items.map((it, i) => (
        <section key={it.id} data-idx={i}
          ref={el => { slides.current[i] = el }}
          className="relative flex items-center justify-center"
          style={{ height: '100dvh', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}>
          {Math.abs(i - active) <= 1 && (
            i === active ? (
              // plain iframe in normal flow — the exact conditions the feed's
              // inline players used, which render on every phone
              <iframe src={reelSrc(it)} title={it.title ?? 'Video'}
                className={it.vertical ? 'h-full aspect-[9/16] max-w-full' : 'w-full aspect-video max-h-full'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen />
            ) : (
              it.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.thumb} alt="" className={`object-cover ${it.vertical ? 'h-full aspect-[9/16] max-w-full' : 'w-full aspect-video'}`} />
              ) : <span className="text-gray-700 text-sm font-bold">Loading…</span>
            )
          )}
          {(it.title || it.username) && i === active && (
            <div className="absolute left-3 right-16 bottom-6 pointer-events-none">
              {it.username && <p className="text-white/70 text-xs font-black">@{it.username}</p>}
              {it.title && <p className="text-white text-sm font-semibold leading-snug line-clamp-2 mt-0.5"
                style={{ textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>{it.title}</p>}
            </div>
          )}
        </section>
      ))}
      <button onClick={() => (history.length > 1 ? router.back() : router.push('/'))} aria-label="Close"
        className="fixed z-20 w-10 h-10 rounded-full bg-black/60 border border-white/25 flex items-center justify-center text-white active:scale-95"
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top))', right: '0.75rem' }}>
        <X size={20} />
      </button>
      {items.length > 1 && active === startIndex && (
        <p className="fixed bottom-2 left-1/2 -translate-x-1/2 z-20 text-white/40 text-[11px] font-bold pointer-events-none">
          swipe up for next ↑
        </p>
      )}
      {items.length === 0 && (
        <div className="h-screen flex items-center justify-center text-gray-500 text-sm font-bold">
          No videos right now — check back soon.
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

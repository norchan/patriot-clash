'use client'
import { useEffect, useRef, useState } from 'react'
import { X, Play } from 'lucide-react'

// Fullscreen reels pager (Michael): tap a video on p/videos → it takes the
// whole screen; swipe UP for the next one, TikTok-style. CSS scroll-snap
// does the paging; an IntersectionObserver tracks the active slide and ONLY
// that slide mounts a playing iframe (neighbors show their thumbnail), so
// swiping never leaves two videos talking over each other.

export interface ReelItem {
  id: string
  kind: 'youtube' | 'tiktok'
  videoId: string
  vertical?: boolean
  thumb?: string
  title?: string | null
  username?: string | null
}

export function reelSrc(it: ReelItem): string {
  return it.kind === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${it.videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${it.videoId}`
    : `https://www.tiktok.com/player/v1/${it.videoId}?autoplay=1`
}

export default function ReelsViewer({ items, startIndex = 0, onClose }: { items: ReelItem[]; startIndex?: number; onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(startIndex)

  // open on the tapped video, no animation
  useEffect(() => {
    wrap.current?.children[startIndex]?.scrollIntoView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the slide filling most of the viewport is the active (playing) one
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.idx))
      }
    }, { root: el, threshold: 0.6 })
    Array.from(el.children).forEach(c => io.observe(c))
    return () => io.disconnect()
  }, [items.length])

  // freeze the page behind the viewer; Esc closes (desktop)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[130] bg-black">
      <div ref={wrap} className="h-full w-full overflow-y-auto snap-y snap-mandatory"
        style={{ scrollbarWidth: 'none' }}>
        {items.map((it, i) => (
          <div key={it.id} data-idx={i}
            className="h-full w-full snap-start snap-always relative flex items-center justify-center">
            {Math.abs(i - active) <= 1 && (
              i === active ? (
                <iframe src={reelSrc(it)} title={it.title ?? 'Video'}
                  className={it.vertical ? 'h-full aspect-[9/16] max-w-full' : 'w-full aspect-video max-h-full'}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen />
              ) : (
                // pre-rendered neighbor: thumbnail only, becomes live on arrival
                it.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumb} alt="" className={`object-cover ${it.vertical ? 'h-full aspect-[9/16] max-w-full' : 'w-full aspect-video'}`} />
                ) : <div className="text-gray-700 text-sm font-bold">Loading…</div>
              )
            )}
            {/* caption — kept clear of the player controls */}
            {(it.title || it.username) && i === active && (
              <div className="absolute left-3 right-16 bottom-6 pointer-events-none">
                {it.username && <p className="text-white/70 text-xs font-black">@{it.username}</p>}
                {it.title && <p className="text-white text-sm font-semibold leading-snug line-clamp-2 mt-0.5"
                  style={{ textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>{it.title}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
      <button onClick={onClose} aria-label="Close"
        className="absolute top-3 right-3 z-10 w-10 h-10 rounded-full bg-black/60 border border-white/25 flex items-center justify-center text-white active:scale-95"
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <X size={20} />
      </button>
      {/* one-time hint */}
      {active === startIndex && items.length > 1 && (
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/40 text-[11px] font-bold pointer-events-none">
          swipe up for next ↑
        </p>
      )}
    </div>
  )
}

// Feed-side launcher: the big thumbnail card that opens the fullscreen pager
// at its own video. Each card carries the whole list so the pager can keep
// scrolling through the feed from wherever the user dove in.
export function ReelCard({ items, index }: { items: ReelItem[]; index: number }) {
  const [open, setOpen] = useState(false)
  const it = items[index]
  if (!it) return null
  return (
    <>
      <button onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(true) }}
        className={`mt-2 relative rounded-2xl overflow-hidden border border-gray-700/80 bg-black block ${it.vertical ? 'max-w-[300px] mx-auto w-full' : 'w-full'}`}
        style={{ aspectRatio: it.vertical ? '9 / 16' : '16 / 9', maxHeight: 540 }}>
        {it.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs font-bold">TikTok</div>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-14 h-14 rounded-full bg-black/70 border border-white/40 flex items-center justify-center">
            <Play size={24} className="text-white ml-0.5" fill="currentColor" />
          </span>
        </span>
      </button>
      {open && <ReelsViewer items={items} startIndex={index} onClose={() => setOpen(false)} />}
    </>
  )
}

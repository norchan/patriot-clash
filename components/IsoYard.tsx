'use client'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { GRID } from '@/config/house'

// ISOMETRIC YARD STAGE (Grok's presentation brief, 2026-07-31).
//
// The 6×6 logical grid (pads 0..35) is unchanged — same data model, same API
// indices — but cells project to screen with the standard 2:1 isometric
// transform instead of a flat CSS grid:
//     x = (col - row) · TILE_W/2        y = (col + row) · TILE_H/2
// Buildings are sprites anchored to the BOTTOM of their diamond and painted
// back-to-front by (row + col), so a tall house correctly overlaps the plot
// behind it. The whole stage lives in a fixed logical coordinate space and is
// scaled to the viewport, which keeps every sprite crisp at any screen size
// and makes tap targets identical across devices.

export const TILE_W = 184
export const TILE_H = 92
// logical stage: wide enough for the 6×6 diamond + headroom for tall sprites
export const STAGE_W = (GRID + GRID) * (TILE_W / 2) + 100   // 988
export const STAGE_H = (GRID + GRID) * (TILE_H / 2) + 300   // 744
const ORIGIN_X = STAGE_W / 2
const ORIGIN_Y = 210

/** Logical stage position of a pad's diamond CENTER. */
export function isoPos(pad: number): { x: number; y: number; depth: number } {
  const col = pad % GRID
  const row = Math.floor(pad / GRID)
  return {
    x: ORIGIN_X + (col - row) * (TILE_W / 2),
    y: ORIGIN_Y + (col + row) * (TILE_H / 2),
    depth: row + col,
  }
}

export interface IsoCellSpec {
  pad: number
  /** show a tappable grass plot diamond under/instead of a sprite */
  plot?: boolean
  img?: string
  /** sprite width in logical px */
  imgW?: number
  emoji?: string
  chip?: ReactNode
  glow?: boolean
  dead?: boolean
  onTap?: () => void
}

/** Fullscreen "turn your phone" gate — the base map is landscape-only. */
export function useLandscape(): boolean {
  const [landscape, setLandscape] = useState(true)
  useEffect(() => {
    const check = () => setLandscape(window.innerWidth >= window.innerHeight)
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    try { (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}) } catch {}
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
      try { (screen.orientation as any)?.unlock?.() } catch {}
    }
  }, [])
  return landscape
}

export function RotateGate() {
  return (
    <div className="fixed inset-0 z-[80] bg-gray-950 flex flex-col items-center justify-center text-center px-8">
      <div className="text-5xl animate-[spin_3s_ease-in-out_infinite]" style={{ animationDirection: 'alternate' }}>📱</div>
      <p className="text-white font-black text-xl mt-4">Rotate your phone</p>
      <p className="text-gray-400 text-sm mt-2">Your base is best surveyed in landscape.</p>
    </div>
  )
}

export default function IsoYard({ cells, bg, children }:
  { cells: IsoCellSpec[]; bg?: string; children?: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      setScale(Math.min(r.width / STAGE_W, r.height / STAGE_H))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sorted = [...cells].sort((a, b) => isoPos(a.pad).depth - isoPos(b.pad).depth)

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden"
      style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
      {/* soft vignette so HUD chips read against bright grass */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)' }} />
      <div className="absolute left-1/2 top-1/2" style={{
        width: STAGE_W, height: STAGE_H,
        transform: `translate(-50%, -50%) scale(${scale})`,
      }}>
        {sorted.map(c => {
          const { x, y, depth } = isoPos(c.pad)
          return (
            <div key={c.pad} className="absolute" style={{ left: x, top: y, zIndex: depth * 10 }}>
              {/* the plot diamond — tap target + subtle ground marking */}
              {(c.plot || c.onTap) && (
                <button onClick={c.onTap} disabled={!c.onTap}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ width: TILE_W, height: TILE_H }}>
                  {c.plot && (
                    <span className="absolute inset-1 rounded-[50%/50%] border transition"
                      style={{
                        transform: 'rotateX(0deg)',
                        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                        background: 'rgba(255,255,255,0.06)',
                        borderColor: 'rgba(255,255,255,0.14)',
                      }} />
                  )}
                </button>
              )}
              {/* grounded shadow under sprites */}
              {(c.img || c.emoji) && !c.dead && (
                <span className="absolute -translate-x-1/2 pointer-events-none"
                  style={{
                    top: -6, width: (c.imgW ?? 120) * 0.8, height: 26,
                    background: 'radial-gradient(ellipse, rgba(0,0,0,0.35), transparent 70%)',
                    transform: 'translateX(-50%)',
                  }} />
              )}
              {/* the sprite itself — anchored to the diamond's base */}
              {c.img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.img} alt=""
                  onClick={c.onTap}
                  className={`absolute max-w-none ${c.onTap ? 'cursor-pointer' : ''} ${c.dead ? 'grayscale opacity-40' : ''} ${c.glow ? 'iso-glow' : ''}`}
                  style={{
                    width: c.imgW ?? 120,
                    left: 0, top: TILE_H * 0.28,
                    transform: 'translate(-50%, -100%)',
                    filter: c.glow ? 'drop-shadow(0 0 14px rgba(52,211,153,0.9))' : 'drop-shadow(0 6px 8px rgba(0,0,0,0.35))',
                  }} />
              ) : c.emoji ? (
                <span onClick={c.onTap}
                  className={`absolute -translate-x-1/2 -translate-y-full select-none ${c.dead ? 'grayscale opacity-40' : ''}`}
                  style={{ fontSize: 44, top: TILE_H * 0.24, filter: 'drop-shadow(0 5px 6px rgba(0,0,0,0.4))' }}>
                  {c.emoji}
                </span>
              ) : null}
              {c.chip && (
                <span className="absolute -translate-x-1/2 whitespace-nowrap pointer-events-none"
                  style={{ top: TILE_H * 0.3, zIndex: 5 }}>
                  {c.chip}
                </span>
              )}
            </div>
          )
        })}
        {children}
      </div>
    </div>
  )
}

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
//
// BOTH orientations are supported (Michael 2026-07-31: the rotate gate also
// caught tall DESKTOP windows — "can we do vertical and rotated?"). Landscape
// gives the biggest yard; portrait scales the same stage to fit the width.

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

export default function IsoYard({ cells, bg, children }:
  { cells: IsoCellSpec[]; bg?: string; children?: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [auto, setAuto] = useState(1)       // fit-derived base scale
  const [zoom, setZoom] = useState(1)       // player zoom on top of it
  const zoomRef = useRef(1)
  const scale = auto * zoom
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      // Landscape: the whole yard fits. Portrait / tall windows: fitting by
      // WIDTH shrinks the yard to a postage stamp, so zoom toward height-fit
      // (capped at 2.2× the width-fit) and let the player PAN — the CoC feel.
      const fitW = r.width / STAGE_W
      const fitH = r.height / STAGE_H
      setAuto(Math.max(fitW, Math.min(fitH, fitW * 2.2)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── zoom in/out (Michael 2026-07-31): mouse wheel on desktop, two-finger
  // pinch on touch. Anchored on the viewport CENTER so the yard doesn't lurch;
  // pan (scroll) covers whatever the zoom uncovers. ──
  const applyZoom = (factor: number) => {
    const el = wrapRef.current
    if (!el) return
    const next = Math.max(0.55, Math.min(2.6, zoomRef.current * factor))
    if (next === zoomRef.current) return
    const ratio = next / zoomRef.current
    const cx = el.scrollLeft + el.clientWidth / 2
    const cy = el.scrollTop + el.clientHeight / 2
    zoomRef.current = next
    setZoom(next)
    requestAnimationFrame(() => {
      el.scrollLeft = cx * ratio - el.clientWidth / 2
      el.scrollTop = cy * ratio - el.clientHeight / 2
    })
  }
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      applyZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    // pinch: track two pointers by hand — browser pinch is page zoom, not ours
    const pts = new Map<number, { x: number; y: number }>()
    let lastDist = 0
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastDist = 0 } }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (lastDist > 0) applyZoom(d / lastDist)
        lastDist = d
      }
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); lastDist = 0 }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [])

  // center the pan when the FIT changes (first layout, rotation) — NOT on
  // player zoom, which anchors itself and must not be snapped back to center
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const s = auto * zoomRef.current
    el.scrollLeft = Math.max(0, (STAGE_W * s - el.clientWidth) / 2)
    el.scrollTop = Math.max(0, (STAGE_H * s - el.clientHeight) / 2)
  }, [auto])

  const sorted = [...cells].sort((a, b) => isoPos(a.pad).depth - isoPos(b.pad).depth)

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-auto overscroll-contain"
      style={{ WebkitOverflowScrolling: 'touch' as any, scrollbarWidth: 'none' }}>
      {/* the pannable ground — bg lives HERE so grass moves with the buildings */}
      <div className="relative" style={{
        width: Math.max(STAGE_W * scale, wrapRef.current?.clientWidth ?? 0),
        height: Math.max(STAGE_H * scale, wrapRef.current?.clientHeight ?? 0),
        ...(bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
      }}>
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
    </div>
  )
}

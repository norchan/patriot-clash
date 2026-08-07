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
  /** second sprite drawn UNDER img at the same anchor — fence corners */
  img2?: string
  /** sprite width in logical px */
  imgW?: number
  emoji?: string
  chip?: ReactNode
  glow?: boolean
  dead?: boolean
  /** render the sprite flipped — a 90° turn in 2D iso is a mirror across the axis */
  mirror?: boolean
  onTap?: () => void
  /** press-and-hold lifts this sprite for drag-and-drop */
  movable?: boolean
}

/** stage coords → pad index, or null when off the diamond */
export function padAt(x: number, y: number): number | null {
  const u = (x - ORIGIN_X) / (TILE_W / 2)
  const v = (y - ORIGIN_Y) / (TILE_H / 2)
  const col = Math.round((u + v) / 2 - 0.5)
  const row = Math.round((v - u) / 2 - 0.5)
  if (col < 0 || col >= GRID || row < 0 || row >= GRID) return null
  return row * GRID + col
}

/** CONNECTED FENCES, done as geometry instead of guesswork (Michael
 *  2026-08-04: "they definitely don't connect... too large"). Each fence CELL
 *  renders only a slim post at its anchor; this component draws the panels
 *  BRIDGING every pair of adjacent fence cells. Instead of hoping generated
 *  art matches the grid's 2:1 diagonal (it never did — that's why runs
 *  zigzagged), the plain FRONT-FACING panel is CSS-sheared onto the diagonal:
 *  verticals stay upright, the baseline follows the exact anchor-to-anchor
 *  slope, so runs connect pixel-perfectly and corners just meet at the shared
 *  post. Render as a child of IsoYard so it lives in stage coordinates. */
const LINK_W = 112   // x-span 112 vs 92 between anchors → overlap hides under posts
const LINK_H = 64

export interface FenceLink { key: string; x: number; y: number; depth: number; shear: 0 | 1 | -1; w: number }

/** Single source of truth for which fences count as connected and what panels
 *  to draw. Two senses of "next to each other" (Michael 2026-08-04, round 2 —
 *  "the fences don't connect when you place them next to each other"):
 *  - GRID-EDGE neighbors (the diamonds share an edge) → sheared diagonal panel
 *  - SCREEN-AXIS corner neighbors (the diamonds a player sees side-by-side or
 *    stacked, which the grid calls diagonal) → straight front-facing panel,
 *    SKIPPED when the pair already connects through a shared fence neighbor,
 *    so proper rings don't grow corner-cutting chords. */
export function fenceAdjacency(fencePads: Set<number>): { links: FenceLink[]; linked: Set<number> } {
  const links: FenceLink[] = []
  const linked = new Set<number>()
  const join = (a: number, b: number, key: string, shear: 0 | 1 | -1, w: number) => {
    const pa = isoPos(a), pb = isoPos(b)
    links.push({ key, x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, depth: Math.max(pa.depth, pb.depth), shear, w })
    linked.add(a); linked.add(b)
  }
  for (const pad of fencePads) {
    const col = pad % GRID, row = Math.floor(pad / GRID)
    // grid-edge pairs — only look "forward" (E and S) so each links exactly once
    if (col < GRID - 1 && fencePads.has(pad + 1)) join(pad, pad + 1, `${pad}e`, 1, LINK_W)
    if (row < GRID - 1 && fencePads.has(pad + GRID)) join(pad, pad + GRID, `${pad}s`, -1, LINK_W)
    // screen-horizontal pair: (row-1, col+1) sits directly RIGHT on screen
    if (row > 0 && col < GRID - 1 && fencePads.has(pad - GRID + 1)
      && !fencePads.has(pad + 1) && !fencePads.has(pad - GRID)) {
      join(pad, pad - GRID + 1, `${pad}h`, 0, TILE_W + 18)
    }
    // screen-vertical pair: (row+1, col+1) sits directly BELOW on screen
    if (row < GRID - 1 && col < GRID - 1 && fencePads.has(pad + GRID + 1)
      && !fencePads.has(pad + 1) && !fencePads.has(pad + GRID)) {
      join(pad, pad + GRID + 1, `${pad}v`, 0, 96)
    }
  }
  return { links, linked }
}

// wall_se.png calibration (Grok P0, model B: CoC wall pieces on the grid
// diagonals — CSS-sheared front panels read as tilted planks). Measured from
// the sprite's own post-base pixels — L(159,606) R(729,921) in a 797×923
// image — then scaled per-axis so the baseline endpoints land EXACTLY on the
// two cell anchors (92 apart in x, 46 in y). The SW piece is the same art
// mirrored; offsets are relative to the link midpoint.
const WALL = { w: 129, h: 135, seLeft: -71.7, swLeft: -57.0, top: -85.7 }

export function IsoFenceLinks({ fencePads }: { fencePads: Set<number> }) {
  const { links } = fenceAdjacency(fencePads)
  return (
    <>
      {links.map(l => l.shear !== 0 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={l.key} src="/house/wall_se.png" alt="" className="absolute max-w-none pointer-events-none"
          style={{
            width: WALL.w, height: WALL.h,
            left: l.x + (l.shear === 1 ? WALL.seLeft : WALL.swLeft),
            top: l.y + WALL.top,
            transform: l.shear === -1 ? 'scaleX(-1)' : undefined,
            zIndex: l.depth * 10 + 2,
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))',
          }} />
      ) : (
        // straight screen-axis bridge between corner-adjacent cells — the
        // front-facing panel IS the correct perspective for those
        // eslint-disable-next-line @next/next/no-img-element
        <img key={l.key} src="/house/fence.png" alt="" className="absolute max-w-none pointer-events-none"
          style={{
            width: l.w, height: LINK_H,
            left: l.x - l.w / 2, top: l.y + TILE_H * 0.28 - LINK_H,
            zIndex: l.depth * 10 + 2,
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))',
          }} />
      ))}
    </>
  )
}

export default function IsoYard({ cells, bg, children, onMove, validTargets, movingFrom }:
  { cells: IsoCellSpec[]; bg?: string; children?: ReactNode
    /** called after a successful drag-and-drop OR tap-to-place in move mode */
    onMove?: (fromPad: number, toPad: number) => void
    /** cells a lifted building may land on */
    validTargets?: Set<number>
    /** menu-driven MOVE MODE (Michael 2026-08-04: long-press fought Chrome's
     *  context menu) — the pad being moved. Targets glow, tapping one places
     *  the building, every other tap is swallowed until the page exits the mode. */
    movingFrom?: number | null }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)  // the pannable ground
  const stageRef = useRef<HTMLDivElement>(null)   // the scaled stage
  const [auto, setAuto] = useState(1)       // fit-derived base scale
  const [zoom, setZoom] = useState(1)       // player zoom on top of it
  const zoomRef = useRef(1)
  const autoRef = useRef(1)
  const pinchRef = useRef(false)  // two fingers down — native pan must not fight the pinch
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
      const a = Math.max(fitW, Math.min(fitH, fitW * 2.2))
      autoRef.current = a
      setAuto(a)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── zoom in/out (Michael 2026-07-31; reworked 2026-08-04 "needs to be more
  // fluent"; buttons + tighter clamp per Grok's P0 brief): anchored under the
  // CURSOR / between the FINGERS, and applied by writing scale + scroll
  // straight to the DOM in the same event — the old React-state +
  // next-frame-scroll version corrected a frame late, which read as a lurch.
  // setZoom() afterwards just keeps React in sync. FROZEN while a building is
  // held or in the air — zoom must never fight a drag. ──
  const applyZoom = (factor: number, anchorX?: number, anchorY?: number) => {
    const el = wrapRef.current, spacer = spacerRef.current, stage = stageRef.current
    if (!el || !spacer || !stage) return
    if (dragRef.current || holdRef.current) return
    const next = Math.max(0.7, Math.min(1.8, zoomRef.current * factor))
    if (next === zoomRef.current) return
    const ratio = next / zoomRef.current
    zoomRef.current = next
    const r = el.getBoundingClientRect()
    const ax = anchorX != null ? anchorX - r.left : el.clientWidth / 2
    const ay = anchorY != null ? anchorY - r.top : el.clientHeight / 2
    const s = autoRef.current * next
    spacer.style.width = `${Math.max(STAGE_W * s, el.clientWidth)}px`
    spacer.style.height = `${Math.max(STAGE_H * s, el.clientHeight)}px`
    stage.style.transform = `translate(-50%, -50%) scale(${s})`
    el.scrollLeft = (el.scrollLeft + ax) * ratio - ax
    el.scrollTop = (el.scrollTop + ay) * ratio - ay
    setZoom(next)
  }
  // "Fit base": back to auto-fit scale, yard centered
  const resetView = () => {
    const el = wrapRef.current, spacer = spacerRef.current, stage = stageRef.current
    if (!el || !spacer || !stage) return
    zoomRef.current = 1
    const s = autoRef.current
    spacer.style.width = `${Math.max(STAGE_W * s, el.clientWidth)}px`
    spacer.style.height = `${Math.max(STAGE_H * s, el.clientHeight)}px`
    stage.style.transform = `translate(-50%, -50%) scale(${s})`
    el.scrollLeft = Math.max(0, (STAGE_W * s - el.clientWidth) / 2)
    el.scrollTop = Math.max(0, (STAGE_H * s - el.clientHeight) / 2)
    setZoom(1)
  }
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // exponential in deltaY: notchy mice get solid steps, trackpads with
      // fine-grained deltas get a perfectly smooth glide
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      applyZoom(Math.exp(-dy * 0.0016), e.clientX, e.clientY)
    }
    // pinch: track two pointers by hand — browser pinch is page zoom, not ours
    const pts = new Map<number, { x: number; y: number }>()
    let lastDist = 0
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastDist = 0; pinchRef.current = pts.size === 2 } }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (lastDist > 0) applyZoom(d / lastDist, (a.x + b.x) / 2, (a.y + b.y) / 2)
        lastDist = d
      }
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); lastDist = 0; pinchRef.current = pts.size === 2 }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── DRAG-AND-DROP (Michael 2026-07-31): press-and-hold lifts a movable
  // sprite, drag follows the finger, drop on a highlighted cell. Native
  // scrolling is suppressed for the duration via a flag-guarded touchmove
  // preventDefault — CSS touch-action can't change mid-gesture. ──
  const [drag, setDrag] = useState<{ from: number; x: number; y: number; hover: number | null } | null>(null)
  const dragRef = useRef<typeof drag>(null)
  dragRef.current = drag
  const holdRef = useRef<{ pad: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const justDroppedAt = useRef(0)

  const toStage = (clientX: number, clientY: number) => {
    const el = wrapRef.current!
    const r = el.getBoundingClientRect()
    const s = auto * zoomRef.current
    const spacerW = Math.max(STAGE_W * s, el.clientWidth)
    const spacerH = Math.max(STAGE_H * s, el.clientHeight)
    const offX = spacerW / 2 - (STAGE_W * s) / 2
    const offY = spacerH / 2 - (STAGE_H * s) / 2
    return {
      x: (clientX - r.left + el.scrollLeft - offX) / s,
      y: (clientY - r.top + el.scrollTop - offY) / s,
    }
  }

  const beginHold = (pad: number, e: React.PointerEvent) => {
    const { clientX, clientY } = e
    const timer = setTimeout(() => {
      if (!holdRef.current || holdRef.current.pad !== pad) return
      const p = toStage(clientX, clientY)
      setDrag({ from: pad, x: p.x, y: p.y, hover: null })
      try { navigator.vibrate?.(30) } catch {}
      holdRef.current = null
    }, 420)
    holdRef.current = { pad, x: clientX, y: clientY, timer }
  }
  const cancelHold = () => {
    if (holdRef.current) { clearTimeout(holdRef.current.timer); holdRef.current = null }
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onMoveEv = (e: PointerEvent) => {
      // a real finger slide before the hold fires = the user is panning
      if (holdRef.current && Math.hypot(e.clientX - holdRef.current.x, e.clientY - holdRef.current.y) > 12) cancelHold()
      const d = dragRef.current
      if (!d) return
      const p = toStage(e.clientX, e.clientY)
      setDrag({ ...d, x: p.x, y: p.y, hover: padAt(p.x, p.y) })
    }
    const onUp = () => {
      cancelHold()
      const d = dragRef.current
      if (!d) return
      if (d.hover != null && d.hover !== d.from && (validTargets?.has(d.hover) ?? false)) {
        justDroppedAt.current = Date.now()
        onMove?.(d.from, d.hover)
      }
      setDrag(null)
    }
    // suppress native pan while a building is in the air OR a pinch is live —
    // otherwise the scroll container pans underneath and the zoom stutters
    const onTouchMove = (e: TouchEvent) => { if (dragRef.current || pinchRef.current) e.preventDefault() }
    window.addEventListener('pointermove', onMoveEv)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      window.removeEventListener('pointermove', onMoveEv)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.removeEventListener('touchmove', onTouchMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, onMove, validTargets])

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
  const debug = typeof window !== 'undefined' && window.location.search.includes('debug=1')

  return (
    <div className="absolute inset-0">
    <div ref={wrapRef} className="absolute inset-0 overflow-auto overscroll-contain"
      // long-press on a sprite must never summon the browser's image menu —
      // that's what broke drag-and-drop on Chrome/Android
      onContextMenu={e => e.preventDefault()}
      style={{ WebkitOverflowScrolling: 'touch' as any, scrollbarWidth: 'none', WebkitTouchCallout: 'none' as any }}>
      {/* the pannable ground — bg lives HERE so grass moves with the buildings */}
      <div ref={spacerRef} className="relative" style={{
        width: Math.max(STAGE_W * scale, wrapRef.current?.clientWidth ?? 0),
        height: Math.max(STAGE_H * scale, wrapRef.current?.clientHeight ?? 0),
        ...(bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
      }}>
      {/* soft vignette so HUD chips read against bright grass */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)' }} />
      <div ref={stageRef} className="absolute left-1/2 top-1/2" style={{
        width: STAGE_W, height: STAGE_H,
        transform: `translate(-50%, -50%) scale(${scale})`,
      }}>
        {sorted.map(c => {
          const { x, y, depth } = isoPos(c.pad)
          const inMove = movingFrom != null
          const isTarget = validTargets?.has(c.pad) ?? false
          // move mode reroutes every tap: valid plots place the building,
          // everything else is inert so sheets can't open mid-move
          const tap = inMove
            ? (isTarget && onMove ? () => onMove(movingFrom!, c.pad) : undefined)
            : c.onTap
          const lifted = (drag != null || inMove) && isTarget
          return (
            <div key={c.pad} className="absolute" style={{ left: x, top: y, zIndex: depth * 10 }}>
              {/* the plot diamond — tap target + subtle ground marking */}
              {(c.plot || c.onTap) && (
                <button onClick={tap ? () => { if (Date.now() - justDroppedAt.current > 350) tap() } : undefined} disabled={!tap}
                  // hold-to-drag works from the whole diamond, not just the
                  // sprite — fences are now a slim post, too thin to grab.
                  // The 350ms guard keeps the drop gesture from ALSO opening
                  // the build sheet on the plot it landed on.
                  onPointerDown={c.movable && onMove && !inMove ? (e => beginHold(c.pad, e)) : undefined}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ width: TILE_W, height: TILE_H, touchAction: c.movable && onMove ? 'none' : undefined }}>
                  {c.plot && (
                    <span className="absolute inset-1 rounded-[50%/50%] border transition"
                      style={{
                        transform: 'rotateX(0deg)',
                        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                        background: lifted
                          ? (drag?.hover === c.pad ? 'rgba(52,211,153,0.45)' : 'rgba(52,211,153,0.18)')
                          : 'rgba(255,255,255,0.06)',
                        borderColor: lifted ? 'rgba(52,211,153,0.7)' : 'rgba(255,255,255,0.14)',
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
              {/* corner underlay (fences meeting from both axes) */}
              {c.img2 && !c.dead && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.img2} alt="" className="absolute max-w-none pointer-events-none"
                  style={{
                    width: c.imgW ?? 120,
                    left: 0, top: TILE_H * 0.28,
                    transform: 'translate(-50%, -100%)',
                    filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.35))',
                  }} />
              )}
              {/* the sprite itself — anchored to the diamond's base */}
              {c.img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.img} alt="" draggable={false}
                  onClick={() => { if (!inMove && Date.now() - justDroppedAt.current > 350) c.onTap?.() }}
                  onPointerDown={c.movable && onMove && !inMove ? (e => beginHold(c.pad, e)) : undefined}
                  className={`absolute max-w-none ${c.onTap ? 'cursor-pointer' : ''} ${c.dead ? 'grayscale opacity-40' : ''} ${c.glow ? 'iso-glow' : ''} ${movingFrom === c.pad ? 'animate-pulse' : ''}`}
                  style={{
                    width: c.imgW ?? 120,
                    left: 0, top: TILE_H * 0.28,
                    transform: `translate(-50%, -100%)${c.mirror ? ' scaleX(-1)' : ''}`,
                    opacity: drag?.from === c.pad ? 0.25 : undefined,
                    filter: movingFrom === c.pad
                      ? 'drop-shadow(0 0 16px rgba(251,191,36,0.95)) brightness(1.1)'
                      : c.glow ? 'drop-shadow(0 0 14px rgba(52,211,153,0.9))' : 'drop-shadow(0 6px 8px rgba(0,0,0,0.35))',
                    touchAction: c.movable && onMove ? 'none' : undefined,
                    WebkitTouchCallout: 'none' as any,
                  }} />
              ) : c.emoji ? (
                <span onClick={inMove ? undefined : c.onTap}
                  className={`absolute -translate-x-1/2 -translate-y-full select-none ${c.dead ? 'grayscale opacity-40' : ''}`}
                  style={{ fontSize: 44, top: TILE_H * 0.24, filter: 'drop-shadow(0 5px 6px rgba(0,0,0,0.4))' }}>
                  {c.emoji}
                </span>
              ) : null}
            </div>
          )
        })}
        {/* CHIPS paint in their own layer ABOVE every sprite (Grok P0: chips
            lived inside depth-sorted cells, so front buildings covered them).
            Depth still orders chips among themselves. */}
        {sorted.map(c => {
          if (!c.chip) return null
          const { x, y, depth } = isoPos(c.pad)
          return (
            <span key={`chip${c.pad}`} className="absolute -translate-x-1/2 whitespace-nowrap pointer-events-none"
              style={{ left: x, top: y + TILE_H * 0.3, zIndex: 1000 + depth }}>
              {c.chip}
            </span>
          )
        })}
        {/* ?debug=1 — diamond outlines + edge midpoints; walls must sit on these lines */}
        {debug && Array.from({ length: GRID * GRID }, (_, pad) => {
          const { x, y } = isoPos(pad)
          return (
            <span key={`dbg${pad}`} className="absolute pointer-events-none" style={{ left: x, top: y, zIndex: 2500 }}>
              <span className="absolute" style={{
                left: -TILE_W / 2, top: -TILE_H / 2, width: TILE_W, height: TILE_H,
                clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                border: '1px solid rgba(255,0,255,0.0)',
                background: 'transparent',
                boxShadow: 'inset 0 0 0 1.5px rgba(255,60,255,0.55)',
              }} />
              {([[TILE_W / 4, TILE_H / 4], [-TILE_W / 4, TILE_H / 4], [TILE_W / 4, -TILE_H / 4], [-TILE_W / 4, -TILE_H / 4]] as const).map(([dx, dy], i) => (
                <span key={i} className="absolute rounded-full" style={{ left: dx - 2, top: dy - 2, width: 4, height: 4, background: '#0ff' }} />
              ))}
            </span>
          )
        })}
        {/* the airborne building follows the finger — above chips, above all */}
        {drag && (() => {
          const src = cells.find(c => c.pad === drag.from)
          if (!src?.img) return null
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src.img} alt="" className="absolute max-w-none pointer-events-none"
              style={{
                width: (src.imgW ?? 120) * 1.08,
                left: drag.x, top: drag.y,
                transform: 'translate(-50%, -85%)',
                zIndex: 3000,
                filter: 'drop-shadow(0 14px 16px rgba(0,0,0,0.5)) brightness(1.08)',
              }} />
          )
        })()}
        {children}
      </div>
      </div>
    </div>
    {/* ── zoom controls, OUTSIDE the scroll container so they never scroll
        away (Grok P0: don't rely on pinch alone) ── */}
    <div className="absolute right-2 top-16 z-[60] flex flex-col gap-1.5">
      <button onClick={() => applyZoom(1.25)} aria-label="Zoom in"
        className="w-9 h-9 rounded-lg bg-black/55 backdrop-blur text-white font-black text-lg border border-white/10 active:scale-90">＋</button>
      <button onClick={() => applyZoom(1 / 1.25)} aria-label="Zoom out"
        className="w-9 h-9 rounded-lg bg-black/55 backdrop-blur text-white font-black text-lg border border-white/10 active:scale-90">－</button>
      <button onClick={resetView} aria-label="Fit base"
        className="w-9 h-9 rounded-lg bg-black/55 backdrop-blur text-white text-sm border border-white/10 active:scale-90">⛶</button>
    </div>
    </div>
  )
}

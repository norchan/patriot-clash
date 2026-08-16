'use client'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { GRID } from '@/config/house'
import BaseStage from '@/components/BaseStage'
import { TILE_W, TILE_H, STAGE_W, STAGE_H, ORIGIN_Y, isoPos, padAt, StageCameraApi } from '@/lib/base-stage'

// ISOMETRIC YARD (Crown Jewel B1 rework).
//
// IsoYard renders the CONTENT of the base — plots, buildings, fences, chips,
// drag-and-drop, deploy taps — in the logical stage space. The CAMERA
// (zoom/pan/inertia/fit) lives in components/BaseStage.tsx, and the geometry
// (tile metrics, stage size, isoPos/padAt, framing rules) in
// lib/base-stage.ts. Home and raid share all three, so the attack view and
// the home view are one engine.
//
// Public surface is unchanged from v1 — cells / bg / onMove / validTargets /
// movingFrom / onStageTap — and the old geometry exports are re-exported
// below for the existing import sites.

export { TILE_W, TILE_H, STAGE_W, STAGE_H, ORIGIN_Y, isoPos, padAt } from '@/lib/base-stage'

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
  /** brief shudder — raids flash this on the cell being hit */
  jiggle?: boolean
  /** render the sprite flipped — a 90° turn in 2D iso is a mirror across the axis */
  mirror?: boolean
  onTap?: () => void
  /** press-and-hold lifts this sprite for drag-and-drop */
  movable?: boolean
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

export default function IsoYard({ cells, bg, children, onMove, validTargets, movingFrom, onStageTap }:
  { cells: IsoCellSpec[]; bg?: string; children?: ReactNode
    /** called after a successful drag-and-drop OR tap-to-place in move mode */
    onMove?: (fromPad: number, toPad: number) => void
    /** cells a lifted building may land on */
    validTargets?: Set<number>
    /** menu-driven MOVE MODE (Michael 2026-08-04: long-press fought Chrome's
     *  context menu) — the pad being moved. Targets glow, tapping one places
     *  the building, every other tap is swallowed until the page exits the mode. */
    movingFrom?: number | null
    /** DEPLOY MODE (raids): a short tap anywhere on the yard reports its
     *  LOGICAL stage coordinates. Pans don't fire (movement > 12px cancels);
     *  plot buttons go tap-transparent so grass taps reach the stage. */
    onStageTap?: (x: number, y: number) => void }) {
  const camRef = useRef<StageCameraApi | null>(null)
  // BaseStage freezes the camera while this is true (a building is lifted)
  const camLockRef = useRef(false)

  // ── DRAG-AND-DROP (Michael 2026-07-31): press-and-hold lifts a movable
  // sprite, drag follows the finger, drop on a highlighted cell. The camera
  // lock (not native-scroll suppression — that era is gone) keeps the world
  // still while a building is in the air. ──
  const [drag, setDrag] = useState<{ from: number; x: number; y: number; hover: number | null } | null>(null)
  const dragRef = useRef<typeof drag>(null)
  dragRef.current = drag
  camLockRef.current = drag != null
  const holdRef = useRef<{ pad: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const justDroppedAt = useRef(0)
  const tapStart = useRef<{ x: number; y: number } | null>(null)

  const toStage = (clientX: number, clientY: number) =>
    camRef.current?.clientToStage(clientX, clientY) ?? { x: 0, y: 0 }

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
    window.addEventListener('pointermove', onMoveEv)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMoveEv)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMove, validTargets])

  const sorted = [...cells].sort((a, b) => isoPos(a.pad).depth - isoPos(b.pad).depth)
  const debug = typeof window !== 'undefined' && window.location.search.includes('debug=1')

  return (
    <BaseStage ground={bg} lockRef={camLockRef} apiRef={camRef} allowDoubleTapFit={!onStageTap}>
      {/* the tap surface for deploy mode covers the whole world */}
      <div className="absolute inset-0"
        onPointerDown={onStageTap ? (e => { tapStart.current = { x: e.clientX, y: e.clientY } }) : undefined}
        onClick={onStageTap ? (e => {
          const st = tapStart.current
          if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 12) return // that was a pan
          const p = toStage(e.clientX, e.clientY)
          if (p.x < -60 || p.x > STAGE_W + 60 || p.y < -60 || p.y > STAGE_H + 60) return
          onStageTap(p.x, p.y)
        }) : undefined}>
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
            <div key={c.pad} className="absolute" style={{ left: x, top: y, zIndex: depth * 10,
              animation: c.jiggle ? 'rdJiggle 0.26s ease-in-out' : undefined }}>
              {/* the plot diamond — tap target + subtle ground marking */}
              {(c.plot || c.onTap) && (
                <button onClick={tap ? () => { if (Date.now() - justDroppedAt.current > 350) tap() } : undefined} disabled={!tap}
                  // hold-to-drag works from the whole diamond, not just the
                  // sprite — fences are now a slim post, too thin to grab.
                  // The 350ms guard keeps the drop gesture from ALSO opening
                  // the build sheet on the plot it landed on.
                  onPointerDown={c.movable && onMove && !inMove ? (e => beginHold(c.pad, e)) : undefined}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ width: TILE_W, height: TILE_H,
                    // in deploy mode, inert plots must not eat yard taps
                    pointerEvents: onStageTap && !tap ? 'none' : undefined }}>
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
    </BaseStage>
  )
}

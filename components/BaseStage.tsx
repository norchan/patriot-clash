'use client'
import { ReactNode, useEffect, useRef, MutableRefObject } from 'react'
import { STAGE_W, STAGE_H, YARD_CENTER, StageCameraApi } from '@/lib/base-stage'

// ═══ BASE STAGE ENGINE v2 (Crown Jewel B1) ══════════════════════════════════
// One camera for the home base AND the raid theater. The old IsoYard camera
// piggybacked on native browser scroll: every zoom frame RESIZED a spacer div
// (full layout pass) and re-derived scroll offsets — workable, never buttery.
//
// v2 is TRANSFORM-ONLY: a fixed viewport (overflow hidden, touch-action none)
// contains one "world" layer at logical STAGE_W×STAGE_H, moved exclusively
// with translate3d(x,y) scale(s) — GPU-composited, zero layout work per
// frame, will-change pinned. All gesture math writes the transform directly
// via refs (no React state in the hot path).
//
// Gestures:
//   · one finger / mouse drag  → pan, with light INERTIA on release
//   · two fingers              → pinch zoom anchored between the fingers
//   · wheel / trackpad         → zoom anchored under the cursor
//   · +/− buttons              → zoom about the view center
//   · ⛶ button / double-tap    → animated "fit base" (double-tap disabled in
//                                deploy mode, where taps drop troops)
// A building drag (IsoYard hold-and-lift) sets `lockRef` — pan, zoom and
// inertia all freeze until the drop, so the camera never fights placement.
//
// Zoom clamps: sMin = full lot + margin (letterboxed), sMax = 1.9× logical.
// Framing rules live in lib/base-stage.ts.

const S_MAX = 1.9
const WHEEL_K = 0.0016
const INERTIA_DECAY = 0.0055  // exp decay constant per ms
const INERTIA_MIN_V = 0.04    // px/ms — below this the glide stops
const FIT_MS = 260

export default function BaseStage({ children, ground, lockRef, apiRef, allowDoubleTapFit = true, onViewChange }: {
  children?: ReactNode
  /** ground plate image url (rendered as the base layer of the world) */
  ground?: string
  /** while .current is true (a building is lifted), the camera is frozen */
  lockRef?: MutableRefObject<boolean>
  /** receives the camera API once mounted */
  apiRef?: MutableRefObject<StageCameraApi | null>
  /** deploy mode sets this false — a double tap there means two troop drops */
  allowDoubleTapFit?: boolean
  onViewChange?: (scale: number) => void
}) {
  const viewRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const cam = useRef({ x: 0, y: 0, s: 0.5 })
  const fits = useRef({ sMin: 0.2, sDefault: 0.5, vw: 1, vh: 1 })
  const raf = useRef<number | null>(null)     // inertia / fit-tween loop
  const gestureAt = useRef(0)                 // last user gesture — cancels tweens

  const apply = () => {
    const w = worldRef.current
    if (w) w.style.transform = `translate3d(${cam.current.x}px, ${cam.current.y}px, 0) scale(${cam.current.s})`
  }

  /** keep the lot on screen: clamp pan (soft 40px slack), center letterboxed axes */
  const clampPan = () => {
    const { vw, vh } = fits.current
    const c = cam.current
    const w = STAGE_W * c.s, h = STAGE_H * c.s
    const slack = 40
    if (w <= vw) c.x = (vw - w) / 2
    else c.x = Math.min(slack, Math.max(vw - w - slack, c.x))
    if (h <= vh) c.y = (vh - h) / 2
    else c.y = Math.min(slack, Math.max(vh - h - slack, c.y))
  }

  const stopRaf = () => { if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null } }

  const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
    if (lockRef?.current) return
    stopRaf()
    gestureAt.current = performance.now()
    const el = viewRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const ax = clientX != null ? clientX - r.left : fits.current.vw / 2
    const ay = clientY != null ? clientY - r.top : fits.current.vh / 2
    const c = cam.current
    const next = Math.max(fits.current.sMin, Math.min(S_MAX, c.s * factor))
    if (next === c.s) return
    // the stage point under the anchor stays under the anchor
    const px = (ax - c.x) / c.s
    const py = (ay - c.y) / c.s
    c.s = next
    c.x = ax - px * next
    c.y = ay - py * next
    clampPan()
    apply()
    onViewChange?.(c.s)
  }

  /** animated glide to the default framing, centered on the diamond */
  const fit = () => {
    if (lockRef?.current) return
    stopRaf()
    const { sDefault, vw, vh } = fits.current
    const from = { ...cam.current }
    const to = {
      s: sDefault,
      x: vw / 2 - YARD_CENTER.x * sDefault,
      y: vh / 2 - YARD_CENTER.y * sDefault,
    }
    // pre-clamp the target so the tween never lands out of bounds
    const keep = { ...cam.current }
    cam.current = { ...to }; clampPan(); Object.assign(to, cam.current); cam.current = keep
    const t0 = performance.now()
    gestureAt.current = t0
    const tick = () => {
      if (gestureAt.current > t0) { raf.current = null; return } // newer gesture wins
      const p = Math.min(1, (performance.now() - t0) / FIT_MS)
      const e = 1 - Math.pow(1 - p, 3)
      cam.current.s = from.s + (to.s - from.s) * e
      cam.current.x = from.x + (to.x - from.x) * e
      cam.current.y = from.y + (to.y - from.y) * e
      apply()
      if (p < 1) raf.current = requestAnimationFrame(tick)
      else { raf.current = null; onViewChange?.(cam.current.s) }
    }
    raf.current = requestAnimationFrame(tick)
  }

  const clientToStage = (clientX: number, clientY: number) => {
    const el = viewRef.current
    const r = el?.getBoundingClientRect()
    const c = cam.current
    return {
      x: (clientX - (r?.left ?? 0) - c.x) / c.s,
      y: (clientY - (r?.top ?? 0) - c.y) / c.s,
    }
  }

  useEffect(() => {
    if (apiRef) apiRef.current = { zoomBy, fit, clientToStage, getScale: () => cam.current.s }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── layout: measure the viewport, derive scale clamps, first framing ──────
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    let first = true
    const measure = () => {
      const r = el.getBoundingClientRect()
      const fitW = r.width / STAGE_W
      const fitH = r.height / STAGE_H
      // min zoom: the WHOLE lot with a touch of margin, letterbox-centered
      const sMin = Math.min(fitW, fitH) * 0.96
      // default: landscape = hero full view; portrait = height-lean chunk,
      // capped at 2.2× width fit (see framing rules in lib/base-stage.ts)
      const sDefault = Math.max(sMin, Math.min(fitH, fitW * 2.2, S_MAX))
      fits.current = { sMin, sDefault, vw: r.width, vh: r.height }
      if (first) {
        first = false
        cam.current.s = sDefault
        cam.current.x = r.width / 2 - YARD_CENTER.x * sDefault
        cam.current.y = r.height / 2 - YARD_CENTER.y * sDefault
      }
      cam.current.s = Math.max(sMin, Math.min(S_MAX, cam.current.s))
      clampPan()
      apply()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── gestures: pan + inertia, pinch, wheel, double-tap ─────────────────────
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const pts = new Map<number, { x: number; y: number }>()
    let lastDist = 0
    let panning = false
    let lastPan = { x: 0, y: 0, t: 0 }
    let vel = { x: 0, y: 0 }
    let lastTap = { t: 0, x: 0, y: 0 }

    const down = (e: PointerEvent) => {
      stopRaf() // grabbing the world stops any glide/tween mid-flight
      gestureAt.current = performance.now()
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        panning = true
        lastPan = { x: e.clientX, y: e.clientY, t: performance.now() }
        vel = { x: 0, y: 0 }
        // double-tap → fit (never in deploy mode)
        if (allowDoubleTapFit && e.pointerType === 'touch') {
          const now = performance.now()
          if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
            lastTap.t = 0
            fit()
          } else lastTap = { t: now, x: e.clientX, y: e.clientY }
        }
      } else {
        panning = false
        lastDist = 0
      }
    }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (lockRef?.current) { panning = false; lastDist = 0; return } // building in the air
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (lastDist > 0 && d > 0) zoomBy(d / lastDist, (a.x + b.x) / 2, (a.y + b.y) / 2)
        lastDist = d
        return
      }
      if (!panning || pts.size !== 1) return
      const now = performance.now()
      const dx = e.clientX - lastPan.x
      const dy = e.clientY - lastPan.y
      const dt = Math.max(1, now - lastPan.t)
      // low-passed velocity for a stable release glide
      vel = { x: 0.75 * (dx / dt) + 0.25 * vel.x, y: 0.75 * (dy / dt) + 0.25 * vel.y }
      lastPan = { x: e.clientX, y: e.clientY, t: now }
      cam.current.x += dx
      cam.current.y += dy
      clampPan()
      apply()
    }
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pts.size === 1) { // pinch → single finger: re-baseline the pan
        const [p] = [...pts.values()]
        panning = true
        lastPan = { x: p.x, y: p.y, t: performance.now() }
        vel = { x: 0, y: 0 }
        lastDist = 0
        return
      }
      if (pts.size > 0) return
      const wasPanning = panning
      panning = false
      lastDist = 0
      // INERTIA: a light CoC glide — only after a real fling, never after a tap
      if (wasPanning && !lockRef?.current && Math.hypot(vel.x, vel.y) > INERTIA_MIN_V * 3) {
        let vx = vel.x, vy = vel.y
        let t = performance.now()
        const glide = () => {
          const now = performance.now()
          const dt = Math.min(40, now - t)
          t = now
          cam.current.x += vx * dt
          cam.current.y += vy * dt
          const k = Math.exp(-dt * INERTIA_DECAY)
          vx *= k; vy *= k
          clampPan()
          apply()
          if (Math.hypot(vx, vy) > INERTIA_MIN_V && !lockRef?.current) raf.current = requestAnimationFrame(glide)
          else { raf.current = null; onViewChange?.(cam.current.s) }
        }
        stopRaf()
        raf.current = requestAnimationFrame(glide)
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // exponential in deltaY: notchy mice get solid steps, fine trackpads glide
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomBy(Math.exp(-dy * WHEEL_K), e.clientX, e.clientY)
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowDoubleTapFit])

  return (
    <div className="absolute inset-0">
      <div ref={viewRef} className="absolute inset-0 overflow-hidden"
        onContextMenu={e => e.preventDefault()}
        style={{ touchAction: 'none', WebkitTouchCallout: 'none' as any }}>
        <div ref={worldRef} className="absolute left-0 top-0" style={{
          width: STAGE_W, height: STAGE_H,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}>
          {/* ── GROUND PLATE (B1 P3): layered, art-ready ─────────────────────
                 base grass → edge fade → vignette. All inside the world so
                 they scale/pan on the same composited transform. Future
                 layers (detail overlay, parallax skirt) slot in here. */}
          {ground && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ground} alt="" draggable={false}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" />
          )}
          {/* edge fade: the lot dissolves into the page instead of a hard crop */}
          <div className="absolute inset-0 pointer-events-none" style={{
            boxShadow: 'inset 0 0 140px 70px rgba(10,12,16,0.55)',
          }} />
          {/* soft center vignette so HUD chips read against bright grass */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.3) 100%)' }} />
          {children}
        </div>
      </div>
      {/* ── zoom controls, outside the gesture surface so they never pan ── */}
      <div className="absolute right-2 top-16 z-[60] flex flex-col gap-1.5">
        <button onClick={() => zoomBy(1.3)} aria-label="Zoom in"
          className="w-9 h-9 rounded-lg bg-black/55 backdrop-blur text-white font-black text-lg border border-white/10 active:scale-90">＋</button>
        <button onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out"
          className="w-9 h-9 rounded-lg bg-black/55 backdrop-blur text-white font-black text-lg border border-white/10 active:scale-90">－</button>
        <button onClick={fit} aria-label="Fit base"
          className="w-9 h-9 rounded-lg bg-black/55 backdrop-blur text-white text-sm border border-white/10 active:scale-90">⛶</button>
      </div>
    </div>
  )
}

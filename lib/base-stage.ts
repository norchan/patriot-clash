// ═══ BASE STAGE GEOMETRY (Crown Jewel B1) ═══════════════════════════════════
// Single source of truth for the isometric yard's logical coordinate space,
// shared by the home base, the raid theater, and the BaseStage camera.
//
// The 10×10 logical grid (pads 0..99, config/house.ts) is UNCHANGED — same
// data model, same API indices. Cells project with the standard 2:1 iso
// transform:
//     x = ORIGIN_X + (col - row) · TILE_W/2
//     y = ORIGIN_Y + (col + row) · TILE_H/2
// Buildings anchor to the BOTTOM of their diamond and paint back-to-front by
// (row + col).
//
// ── SPACE / FRAMING RULES (B1) ─────────────────────────────────────────────
// The lot is the diamond plus REAL margins, so the base reads as a place,
// not a sprite sheet cropped to its content:
//   · SIDE_PAD   150 logical px of grass beyond the E/W corners
//   · TOP_PAD    270 — headroom for the tallest sprites (hq5 ≈ 260 above its
//                 anchor) so max zoom never decapitates the mansion
//   · BOTTOM_PAD 210 — foreground apron; raid troops release from here
// Camera framing (see BaseStage):
//   · min zoom  = whole lot + margin visible (letterboxed, centered)
//   · max zoom  = 1.9× logical — building-detail reading distance, still
//                 crisp for the current art sizes
//   · default   = landscape: hero full-lot view (height fit);
//                 portrait: height-lean fit capped at 2.2× width fit — a
//                 satisfying CHUNK of base you pan around, CoC-style

import { GRID } from '@/config/house'

export const TILE_W = 184
export const TILE_H = 92

const SIDE_PAD = 150
const TOP_PAD = 270
const BOTTOM_PAD = 210

export const STAGE_W = GRID * TILE_W + SIDE_PAD * 2          // 2140
export const STAGE_H = GRID * TILE_H + TOP_PAD + BOTTOM_PAD  // 1400
export const ORIGIN_X = STAGE_W / 2
export const ORIGIN_Y = TOP_PAD

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

/** stage coords → pad index, or null when off the diamond */
export function padAt(x: number, y: number): number | null {
  const u = (x - ORIGIN_X) / (TILE_W / 2)
  const v = (y - ORIGIN_Y) / (TILE_H / 2)
  const col = Math.round((u + v) / 2 - 0.5)
  const row = Math.round((v - u) / 2 - 0.5)
  if (col < 0 || col >= GRID || row < 0 || row >= GRID) return null
  return row * GRID + col
}

/** The visual center of the diamond — camera fit target. */
export const YARD_CENTER = {
  x: ORIGIN_X,
  y: ORIGIN_Y + (GRID - 1) * (TILE_H / 2),
}

// ── Camera API contract (implemented by components/BaseStage.tsx) ──────────
export interface StageCameraApi {
  /** multiply zoom by `factor`, anchored at client coords (default: view center) */
  zoomBy: (factor: number, clientX?: number, clientY?: number) => void
  /** animate back to the default framing */
  fit: () => void
  /** client/viewport coords → logical stage coords */
  clientToStage: (clientX: number, clientY: number) => { x: number; y: number }
  /** current world scale (logical px → screen px) */
  getScale: () => number
}

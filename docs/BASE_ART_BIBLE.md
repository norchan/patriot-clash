# Base Art Bible — Campaign HQ / Raids

One visual language for everything on the yard. Every new sprite — building,
troop, defense, effect — matches this or it doesn't ship. (Crown Jewel B2,
2026-08-16. The generator prompt in `scripts/gen_b2_buildings.mjs` is this
bible condensed — keep them in sync.)

## 1. Camera
- **Fixed 2:1 isometric**, three-quarter view — the projection is
  `TILE_W = 184 × TILE_H = 92` (`lib/base-stage.ts`). No perspective, no
  camera tilt variation between sprites.
- A building's *footprint* is its diamond. Tall structures grow **up**, never
  spill past their footprint sideways.

## 2. Light
- **One key light, top-left**, warm (late-afternoon gold). Soft cool ambient
  fill on the shadow side.
- No baked cast shadows on the ground — the stage renders its own soft blob
  under every sprite (IsoYard). Painted contact shading ON the structure is
  fine; painted shadow ON the grass is not.

## 3. Edges
- **Clean cutout silhouette** — crisp, confident edges (the CoC read), not
  soft/feathered photography edges. One treatment for the whole set.

## 4. Palette
- Grass: fresh saturated green (the plate: `public/house/yard_bg2.webp`)
- Timber: warm browns `#8a5a2b`–`#c98d4e`
- Stone: weathered cool greys
- Metal: desaturated steel with gold trim accents on prestige levels
- Party accents: republican red `#dc2626` / democrat blue `#2563eb` — flags
  and trim only, never whole walls
- Slightly chunky, toy-like proportions; saturated but grounded

## 5. Scale (logical stage px, the `imgW` contract)
| Sprite | width | note |
|---|---|---|
| HQ | 198 | the hero — tallest thing on the lot |
| Barracks | 150 | second-largest |
| Solar | 134 | low and wide |
| Print shop | 128 | |
| Media tower | 126 | tall and thin |
| Turret | 118 | |
| Doberman | 104 | |
| Safe | 96 | small and dense |
| Decor | 84 | |
| Fence link | 112–129 | **calibrated — do not re-art without re-measuring `WALL` in IsoYard.tsx** |
| Troops (raid) | ~84, height 92 | must read at default zoom |

Level progressions (1→5) must be readable at default zoom: bigger, richer,
more trim — not just recolors.

## 6. Export
- **WebP**, quality ~82, trimmed to content (no transparent slop margins)
- Source render ≥ 3× the logical width (max zoom is 1.9× on a 1.5-DPR cap)
- Budget: **≤ 150 KB** per building image (most land 30–80 KB)
- **True alpha.** No painted grass mats, dirt patches, or ground plates under
  the structure — the sprite ends at the building's own footprint.

## 7. Damage language (raid-relevant types)
- **Intact** — the normal sprite
- **Damaged** (post-raid, repair countdown) — the same sprite, charred: the
  stage renders `grayscale + darken + sepia` over it (IsoYard `dead` look);
  dedicated damaged frames can replace the filter later, same slot
- **Rubble** (smashed mid-raid) — sprite keeps standing under the filter with
  the strike FX on top; dedicated rubble art is a later step (B7)
- The doberman never shows damage — he leaves, he doesn't break

## 8. Pipeline
1. Edit-chain from the live sprite (`input_fidelity: high`) — identity first
2. `background: transparent` at generation (no cutout pass)
3. `sharp`: trim → resize to target width → WebP q82
4. Verify on the stage at min zoom AND max zoom before replacing
5. Delete the replaced file from the live path

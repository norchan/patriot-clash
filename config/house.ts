// CAMPAIGN HQ — personal base config (Michael 2026-07-31, from Grok's brief
// with amendments Michael approved: 16 pads not 8, buy-to-unlock expansion,
// every building DOES something, real table not JSON).
//
// The base is PERSONAL: raids (Phase 2) will steal FP/items, never flip a town
// hall — the geographic game stays the only way to take cities.
//
// Single source of truth for pad layout, costs and yields. The API route reads
// costs from HERE and passes them to atomic SQL functions — the client never
// sends a price, the same trust boundary as the fp-packs catalog.

export type BuildingType = 'fence' | 'media_tower'

// ── The yard ────────────────────────────────────────────────────────────────
// 4×4 grid, pad indexes 0..15 laid out row-major. Two pads are FIXED and free:
// the HQ house and the Print Shop (players already own the farm — it becomes a
// building). The other 14 are buildable; 6 start unlocked, 8 more are bought
// with FP in a fixed order (clearing your lot IS progression).
export const GRID = 4
export const HQ_PAD = 5          // center-left — the house itself
export const PRINT_SHOP_PAD = 6  // next to the house
export const FIXED_PADS = [HQ_PAD, PRINT_SHOP_PAD] as const

/** Buildable pads in UNLOCK ORDER: first 6 are free at start, the rest are
 *  purchased left-to-right through this list. Order spirals outward from the
 *  house so an early base clusters around the HQ instead of scattering. */
export const PAD_UNLOCK_ORDER = [1, 2, 9, 10, 4, 7, 0, 3, 8, 11, 13, 14, 12, 15] as const
export const FREE_PADS = 6

/** Cost of the Nth purchased pad (0-based past the free ones). Rising — the
 *  15th pad should be a milestone, not pocket change. */
export const PAD_COSTS = [150, 250, 400, 600, 850, 1100, 1400, 1750] as const

// ── Buildings ───────────────────────────────────────────────────────────────
export interface BuildingDef {
  type: BuildingType
  name: string
  emoji: string
  desc: string
  /** cost of level 1, 2, 3 — index = level-1 */
  costs: readonly number[]
  /** only one allowed on the whole base (income buildings don't stack) */
  unique?: boolean
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  fence: {
    type: 'fence',
    name: 'Security Fence',
    emoji: '🧱',
    desc: 'Hardens your base against raids (raids are coming — priced gently until they land)',
    // deliberately cheap: its defense value is invisible until Phase 2 raids
    // exist, and players should not pay real FP for a promise
    costs: [100, 250, 500],
  },
  media_tower: {
    type: 'media_tower',
    name: 'Media Tower',
    emoji: '📡',
    desc: 'Broadcasts your message — generates FP over time. Claim it like the Print Shop.',
    costs: [500, 1200, 2500],
    unique: true,
  },
}

// ── Media Tower income ──────────────────────────────────────────────────────
// A slow FP trickle so the base pays you back for visiting. Clamped hard:
// yields are per-INTERVAL with a small bank cap, all enforced in one atomic
// SQL function (claim + grant in a single transaction, like the arcade).
// Payback on L1 is ~4 days — a sink first, a faucet slowly.
export const TOWER_INTERVAL_SECS = 6 * 3600           // one payout every 6h
export const TOWER_BANK_INTERVALS = 2                  // banks at most 2 payouts
export const TOWER_RATE_BY_LEVEL = [30, 60, 100] as const  // FP per payout, L1..L3
export const TOWER_MAX_LEVEL = TOWER_RATE_BY_LEVEL.length

/** FP claimable right now given seconds since last claim — mirrored by the
 *  SQL function; the test suite pins the two against each other's constants. */
export function towerBanked(elapsedSecs: number, level: number): number {
  const rate = TOWER_RATE_BY_LEVEL[Math.max(0, Math.min(TOWER_MAX_LEVEL, level) - 1)] ?? 0
  const intervals = Math.min(TOWER_BANK_INTERVALS, Math.floor(Math.max(0, elapsedSecs) / TOWER_INTERVAL_SECS))
  return intervals * rate
}

/** Cost to unlock the next pad, or null when the yard is fully open. */
export function nextPadCost(unlockedCount: number): number | null {
  const bought = unlockedCount - FREE_PADS
  if (bought < 0) return PAD_COSTS[0]
  return bought < PAD_COSTS.length ? PAD_COSTS[bought] : null
}

export const buildingDef = (t: string): BuildingDef | undefined =>
  (BUILDINGS as Record<string, BuildingDef>)[t]

/** Build (or upgrade-to-level) cost — level is 1-based. */
export function buildingCost(type: string, level: number): number | null {
  const def = buildingDef(type)
  if (!def) return null
  return def.costs[level - 1] ?? null
}

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

export type BuildingType = 'fence' | 'media_tower' | 'safe'

// ── The yard ────────────────────────────────────────────────────────────────
// 6×6 OPEN grid, cell indexes 0..35 row-major (Michael 2026-07-31: rejected
// my 16-pad buy-to-unlock version — "your pad idea sucks. Do groks version").
// Grok's brief: a small open grid, build anywhere. Two cells are FIXED and
// free — the HQ house and the Print Shop (the farm players already own).
// Every other cell is buildable from day one; progression is what you BUILD,
// not land you unlock.
export const GRID = 6
export const HQ_PAD = 14          // center — the house itself
export const PRINT_SHOP_PAD = 15  // next door
export const FIXED_PADS = [HQ_PAD, PRINT_SHOP_PAD] as const

/** Every buildable cell (the whole lot minus the two fixed ones). */
export const BUILDABLE_CELLS: readonly number[] =
  Array.from({ length: GRID * GRID }, (_, i) => i).filter(i => !(FIXED_PADS as readonly number[]).includes(i))

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
  safe: {
    type: 'safe',
    name: 'The Safe',
    emoji: '🔐',
    desc: 'Lock FP inside — raiders can never touch what is in the safe. Bigger safe, bigger vault.',
    costs: [250, 750, 2000, 5000, 12000],
    unique: true,
  },
}

// ── The SAFE — raid-proof FP storage (Michael 2026-07-31) ───────────────────
// "Allow players to lock a certain portion of their fp in a safe... The higher
// the level, the more they can lock up. That should stop people from farming
// bases." Art: public/house/safe1..5.png (his sheet, same slicer as the house).
//
// The mechanic is deliberately simple: safe_fp is a SEPARATE column, and the
// raid engine loots from fp_balance only — so deposited FP isn't shielded by a
// formula, it's structurally unreachable. The tradeoff that keeps it honest:
// FP in the safe can't be SPENT either (every spend path reads fp_balance);
// you withdraw first, and while it's out, it's raidable.
export const SAFE_CAPACITY = [1000, 2500, 6000, 15000, 40000] as const
export const SAFE_MAX_LEVEL = SAFE_CAPACITY.length
export const safeCapacity = (level: number) =>
  SAFE_CAPACITY[Math.max(0, Math.min(SAFE_MAX_LEVEL, level) - 1)] ?? 0
export const safeImage = (level: number) =>
  `/house/safe${Math.max(1, Math.min(SAFE_MAX_LEVEL, level))}.png`

// ── The HOUSE itself — 5 upgrade levels (Michael's art, 2026-07-31) ─────────
// The centerpiece: a shack at L1, solar panels by L3, a crystal-crowned manor
// at L5. Art: public/house/hq1.png..hq5.png (sliced from Michael's sheet by
// scripts/slice_hq_houses.mjs). Upgrading the house is the long-term FP sink,
// and it DEFENDS: for humans the house level IS the base level, which feeds
// the raid defense score — a better house is genuinely harder to crack.
export const HQ_MAX_LEVEL = 5
/** cost to reach level 2, 3, 4, 5 — index = (targetLevel - 2) */
export const HQ_UPGRADE_COSTS = [500, 1500, 4000, 10000] as const
export const hqImage = (level: number) =>
  `/house/hq${Math.max(1, Math.min(HQ_MAX_LEVEL, level))}.png`
export function hqUpgradeCost(currentLevel: number): number | null {
  if (currentLevel < 1 || currentLevel >= HQ_MAX_LEVEL) return null
  return HQ_UPGRADE_COSTS[currentLevel - 1] ?? null
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

export const buildingDef = (t: string): BuildingDef | undefined =>
  (BUILDINGS as Record<string, BuildingDef>)[t]

/** Build (or upgrade-to-level) cost — level is 1-based. */
export function buildingCost(type: string, level: number): number | null {
  const def = buildingDef(type)
  if (!def) return null
  return def.costs[level - 1] ?? null
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — RAIDS (Michael 2026-07-31)
// Personal-base raids: pay to attack, capped loot, never touches town halls.
//
// ANTI-FARMING (the bots are the obvious exploit — 2,730 of them with real
// FP balances). Four stacked limits, all enforced in ONE SQL transaction:
//   1. entry fee (RAID_COST) — farming has a price
//   2. daily raid cap (RAID_DAILY_CAP)
//   3. daily BOT-loot clamp (BOT_LOOT_DAILY_CAP) — human loot is zero-sum
//      (it leaves the victim's balance), bot loot is a faucet, so only bot
//      loot is budget-capped, same pattern as the arcade budget
//   4. same defender only once per 24h (pair cooldown)
// Worst case perfect play: 10 raids × 50 = 500 FP in, ≤900 FP out of bots =
// max +400/day — under half the sign-in bonus. When Michael retires the bots,
// raids keep working human-vs-human unchanged (those are zero-sum transfers).
// ═══════════════════════════════════════════════════════════════════════════

export const RAID_COST = 50                 // FP to launch a raid
export const RAID_DAILY_CAP = 10            // raids per attacker per day
export const BOT_LOOT_DAILY_CAP = 900       // FP/day lootable from bots total
export const RAID_PAIR_COOLDOWN_HOURS = 24  // same defender once a day
export const RAID_SHIELD_HOURS = 8          // human defenders get a shield after being hit
export const RAID_LOOT_PCT = 0.06           // % of defender balance at stake
export const raidLootAbsCap = (baseLevel: number) => 150 + 25 * baseLevel

// Damage roll: attacker level vs defense score, ±15 noise, floor/ceiling so
// every raid does SOMETHING and nothing is a guaranteed wipe.
export function raidDamagePct(attackerLevel: number, defenseScore: number, roll: number): number {
  const noise = Math.floor(roll * 31) - 15 // roll∈[0,1) → -15..+15
  return Math.max(35, Math.min(100, 55 + (attackerLevel - defenseScore) * 4 + noise))
}

/** Defender defense score from their real buildings. */
export function defenseScore(buildings: Array<{ type: string; level: number }>, baseLevel: number): number {
  let s = baseLevel
  for (const b of buildings) {
    if (b.type === 'fence') s += b.level * 2
    if (b.type === 'media_tower') s += 1 // a tower is a target, barely a defense
  }
  return s
}

export function trophiesFor(damagePct: number): number {
  return damagePct >= 85 ? 5 : damagePct >= 50 ? 3 : 1
}

// ── Bot bases — DERIVED, never stored ───────────────────────────────────────
// 2,730 bots must not become 2,730 rows of base state. A bot's base is a pure
// function of its id + level: same bot always shows the same base, higher
// level bots have visibly bigger bases (Michael's rule), and when the bots
// are retired nothing needs cleaning up.
export interface BotBase {
  baseLevel: number   // 1..5
  buildings: Array<{ pad: number; type: BuildingType | 'decor'; level: number }>
  padsOpen: number
}

function h32(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function botBase(botId: string, level: number): BotBase {
  const baseLevel = 1 + Math.min(4, Math.floor(level / 3))
  const seed = h32(botId)
  const cells = BUILDABLE_CELLS
  const buildings: BotBase['buildings'] = []
  // scaled UP for the 6×6 lot: a level-5 bot fills a rich yard (~18 builds),
  // a level-1 bot has a modest starter patch — the size difference IS the tell
  const fences = 2 + baseLevel * 2
  for (let i = 0; i < fences; i++) {
    buildings.push({ pad: cells[(seed + i * 7) % cells.length], type: 'fence', level: Math.min(3, 1 + ((seed >> (i + 2)) % baseLevel)) })
  }
  buildings.push({ pad: cells[(seed + 3) % cells.length], type: 'media_tower', level: Math.min(3, baseLevel) })
  buildings.push({ pad: cells[(seed + 17) % cells.length], type: 'safe', level: Math.min(5, baseLevel) })
  // decor makes big bases LOOK rich (flags, signs — pure rendering)
  for (let i = 0; i < 1 + baseLevel; i++) {
    buildings.push({ pad: cells[(seed + 11 + i * 5) % cells.length], type: 'decor', level: 1 })
  }
  // dedupe by pad, first write wins
  const seen = new Set<number>()
  return {
    baseLevel,
    padsOpen: cells.length,
    buildings: buildings.filter(b => (seen.has(b.pad) ? false : (seen.add(b.pad), true))),
  }
}

export const botDefenseScore = (baseLevel: number) => baseLevel * 3

// ── Yard pickups — the little endorphin taps ────────────────────────────────
// Sparkles appear on your own yard over time; each tap claims a few FP.
// Server-banked exactly like the print shop: 1 pickup every 2h, holds 5,
// worth 2–6 FP each — a ~50 FP/day ceiling, pocket change with confetti.
export const PICKUP_INTERVAL_SECS = 2 * 3600
export const PICKUP_BANK_CAP = 5
export const PICKUP_MIN_FP = 2
export const PICKUP_MAX_FP = 6

export function pickupsBanked(elapsedSecs: number): number {
  return Math.min(PICKUP_BANK_CAP, Math.floor(Math.max(0, elapsedSecs) / PICKUP_INTERVAL_SECS))
}

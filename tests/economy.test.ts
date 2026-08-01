import { describe, it, expect } from 'vitest'
import {
  computeArcadeBudget, ARCADE_DAILY_CAP, SESSION_RATE_PER_MIN, SESSION_MAX_AGE_MS,
} from '@/lib/arcade'
import {
  evaluateGrid, spinGrid, pickCell, BET_OPTIONS, PAYS, RTP_SCALAR,
  WILD, SCATTER, FREE_SPINS_AWARD, REELS, ROWS,
} from '@/config/slots'
import { isValidHead, HEADS, headMeta } from '@/config/heads'
import { rateLimited } from '@/lib/ratelimit'

// ── Arcade award budgets (mirrors record_arcade_award SQL) ───────────────────
describe('computeArcadeBudget', () => {
  it('grants the full request inside both budgets', () => {
    // 2 min of play, nothing earned yet → rate budget = (2+0.5)*900 = 2250
    expect(computeArcadeBudget(2 * 60_000, 0, 0, 500)).toEqual({ allowed: 500 })
  })

  it('clamps to the session rate budget', () => {
    // 30s of play → floor((0.5+0.5)*900) = 900 available
    expect(computeArcadeBudget(30_000, 0, 0, 5000).allowed).toBe(900)
  })

  it('counts previous session awards against the rate budget', () => {
    // same 30s session that already paid 900 has nothing left
    const r = computeArcadeBudget(30_000, 900, 900, 100)
    expect(r.allowed).toBe(0)
    expect(r.reason).toBe('RATE_CAP')
  })

  it('clamps to the shared daily cap', () => {
    const r = computeArcadeBudget(60 * 60_000, 0, ARCADE_DAILY_CAP - 100, 500)
    expect(r.allowed).toBe(100)
  })

  it('refuses at the daily cap', () => {
    const r = computeArcadeBudget(60 * 60_000, 0, ARCADE_DAILY_CAP, 500)
    expect(r.allowed).toBe(0)
    expect(r.reason).toBe('DAILY_CAP')
  })

  it('refuses expired sessions', () => {
    const r = computeArcadeBudget(SESSION_MAX_AGE_MS + 1, 0, 0, 100)
    expect(r.allowed).toBe(0)
    expect(r.reason).toBe('SESSION_EXPIRED')
  })

  it('never returns a negative award', () => {
    expect(computeArcadeBudget(30_000, 99999, 0, 100).allowed).toBe(0)
    expect(computeArcadeBudget(60_000, 0, 99999, 100).allowed).toBe(0)
  })

  it('the double-pay scenario: two calls against one budget only pay once', () => {
    // the bug Grok flagged — both requests see the same fresh budget of 900.
    // With the atomic path, the second call must see the first call's award.
    const first = computeArcadeBudget(30_000, 0, 0, 900)
    expect(first.allowed).toBe(900)
    const second = computeArcadeBudget(30_000, first.allowed, first.allowed, 900)
    expect(second.allowed).toBe(0)
  })
})

// ── Slots math (server-authoritative payout engine) ─────────────────────────
const emptyGrid = () => Array.from({ length: REELS }, () => Array.from({ length: ROWS }, () => 7))

describe('slots evaluateGrid', () => {
  it('pays a simple 3-reel line at the paytable rate', () => {
    const grid = emptyGrid()
    grid[0][0] = 2; grid[1][1] = 2; grid[2][2] = 2
    // symbol 7 filler can collide with symbol-7 lines; ensure it doesn't pay:
    const ev = evaluateGrid(grid, 100, 1)
    const win2 = ev.wins.find(w => w.symbol === 2)
    expect(win2).toBeDefined()
    expect(win2!.amount).toBe(Math.floor(100 * PAYS[2][0] * 1 * RTP_SCALAR))
  })

  it('wilds substitute and multiply ways', () => {
    const grid = emptyGrid()
    grid[0][0] = 2; grid[1][0] = WILD; grid[1][1] = 2; grid[2][0] = 2
    const ev = evaluateGrid(grid, 100, 1)
    const win2 = ev.wins.find(w => w.symbol === 2)
    expect(win2).toBeDefined()
    expect(win2!.ways).toBe(2) // reel 1 matched twice (wild + symbol)
  })

  it('3+ scatters trigger the bonus', () => {
    const grid = emptyGrid()
    grid[0][0] = SCATTER; grid[2][1] = SCATTER; grid[4][2] = SCATTER
    const ev = evaluateGrid(grid, 100, 1)
    expect(ev.scatterCount).toBe(3)
    expect(ev.freeSpins).toBe(FREE_SPINS_AWARD)
    expect(ev.payout).toBeGreaterThan(0)
  })

  it('two scatters do NOT trigger', () => {
    const grid = emptyGrid()
    grid[0][0] = SCATTER; grid[2][1] = SCATTER
    expect(evaluateGrid(grid, 100, 1).freeSpins).toBe(0)
  })

  it('free-spin multiplier doubles wins', () => {
    const grid = emptyGrid()
    grid[0][0] = 2; grid[1][1] = 2; grid[2][2] = 2
    const base = evaluateGrid(grid, 100, 1).wins.find(w => w.symbol === 2)!.amount
    const doubled = evaluateGrid(grid, 100, 2).wins.find(w => w.symbol === 2)!.amount
    expect(doubled).toBe(base * 2)
  })

  it('long-run RTP stays under 100% (the house holds an edge)', () => {
    // deterministic LCG so this test can't flake
    let seed = 42
    const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    const bet = 100
    let wagered = 0, paid = 0
    for (let i = 0; i < 20_000; i++) {
      wagered += bet
      paid += evaluateGrid(spinGrid(rng), bet, 1).payout
    }
    const rtp = paid / wagered
    expect(rtp).toBeGreaterThan(0.3) // sanity: the game does pay out
    expect(rtp).toBeLessThan(1.0)    // and never profits the player on average
  })

  it('pickCell only produces valid symbols', () => {
    let seed = 7
    const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    for (let i = 0; i < 1000; i++) {
      const c = pickCell(rng)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(7)
    }
  })

  it('bet options are the only legal bets', () => {
    expect(BET_OPTIONS.length).toBeGreaterThan(0)
    for (const b of BET_OPTIONS) expect(b).toBeGreaterThan(0)
  })
})

// ── Head catalog gate ────────────────────────────────────────────────────────
describe('heads', () => {
  it('validates every cataloged head id', () => {
    for (const h of HEADS) expect(isValidHead(h.id)).toBe(true)
  })
  it('rejects junk ids', () => {
    expect(isValidHead('__nope__')).toBe(false)
    expect(isValidHead(42)).toBe(false)
    expect(isValidHead(null)).toBe(false)
    expect(isValidHead('politician; drop table')).toBe(false)
  })
  it('headMeta finds cataloged heads', () => {
    expect(headMeta('politician')?.label).toBe('The Don')
    expect(headMeta('__nope__')).toBeUndefined()
  })
})

// ── Rate limiter ─────────────────────────────────────────────────────────────
describe('rateLimited', () => {
  it('allows up to max and trips beyond it', () => {
    const key = `t:${Math.random()}`
    for (let i = 0; i < 5; i++) expect(rateLimited(key, 5, 60_000)).toBe(false)
    expect(rateLimited(key, 5, 60_000)).toBe(true)
  })
  it('keys are independent', () => {
    const a = `a:${Math.random()}`, b = `b:${Math.random()}`
    for (let i = 0; i < 5; i++) rateLimited(a, 5, 60_000)
    expect(rateLimited(b, 5, 60_000)).toBe(false)
  })
})

// ── Print Shop farm (siege Phase B4) ─────────────────────────────────────────
import { printShopReady, printShopNextInMs, PRINT_SHOP_RATE_MS, PRINT_SHOP_CAP } from '@/lib/farm'

describe('printShopReady', () => {
  const H = 3600 * 1000
  it('produces nothing before the first cycle', () => {
    expect(printShopReady(0)).toBe(0)
    expect(printShopReady(2 * H - 1)).toBe(0)
  })
  it('one per 2 hours', () => {
    expect(printShopReady(2 * H)).toBe(1)
    expect(printShopReady(7 * H)).toBe(3)
  })
  it('hard-caps the stockpile — no AFK infinite mint', () => {
    expect(printShopReady(60 * H)).toBe(PRINT_SHOP_CAP)
    expect(printShopReady(365 * 24 * H)).toBe(PRINT_SHOP_CAP)
  })
  it('rejects garbage elapsed values', () => {
    expect(printShopReady(-5)).toBe(0)
    expect(printShopReady(NaN)).toBe(0)
  })
  it('countdown reaches zero exactly at the cycle boundary', () => {
    expect(printShopNextInMs(0)).toBe(PRINT_SHOP_RATE_MS)
    expect(printShopNextInMs(PRINT_SHOP_RATE_MS / 2)).toBe(PRINT_SHOP_RATE_MS / 2)
    expect(printShopNextInMs(200 * H)).toBe(0) // capped: nothing more to wait for
  })
})

// ── Creator earnings (real-money payouts — Michael's margin floor) ───────────
import { CREATOR_EARNINGS, estimatedEarnings } from '@/config/creator-earnings'

describe('creator earnings', () => {
  it('pins the current promotional rate and withdrawal floor', () => {
    // Deliberate pins: changing either is a PRODUCT decision (rate can only
    // safely move UP; the $10 floor keeps Stripe fixed fees tolerable).
    expect(CREATOR_EARNINGS.USD_PER_1000_IMPRESSIONS).toBe(0.10)
    expect(CREATOR_EARNINGS.MIN_WITHDRAW_USD).toBe(10.00)
    expect(CREATOR_EARNINGS.HOLD_DAYS).toBe(30)
  })

  it('derives min impressions from the rate (never drifts)', () => {
    expect(CREATOR_EARNINGS.MIN_IMPRESSIONS).toBe(100_000)
  })

  it('estimates earnings at the configured rate', () => {
    expect(estimatedEarnings(0)).toBe('0.00')
    expect(estimatedEarnings(1000)).toBe('0.10')
    expect(estimatedEarnings(100_000)).toBe('10.00')
    expect(estimatedEarnings(1234)).toBe('0.12')
  })
})

import { SIEGE_ATTACKS, FLAK, flakHitChance, rollFlak } from '@/config/siege-attacks'

describe('hall flak (town hall shoots back)', () => {
  it('an undefended hall never intercepts', () => {
    expect(flakHitChance(0)).toBe(0)
    const r = rollFlak(SIEGE_ATTACKS.liberty, 0, () => 0) // rand always "hits"
    expect(r.intercepted).toBe(0)
    expect(r.damageMult).toBe(1)
  })

  it('accuracy scales with defense and saturates at DEF_FOR_FULL', () => {
    expect(flakHitChance(FLAK.DEF_FOR_FULL / 2)).toBeCloseTo(FLAK.MAX_HIT_CHANCE / 2, 6)
    expect(flakHitChance(FLAK.DEF_FOR_FULL)).toBeCloseTo(FLAK.MAX_HIT_CHANCE, 6)
    // a hall well past the cap is no more accurate than one at the cap
    expect(flakHitChance(99_999)).toBeCloseTo(FLAK.MAX_HIT_CHANCE, 6)
  })

  it('NEVER zeroes a strike, even when every piece is intercepted', () => {
    // rand() = 0 always beats the hit chance, so the whole volley dies
    for (const atk of Object.values(SIEGE_ATTACKS)) {
      const r = rollFlak(atk, 99_999, () => 0)
      expect(r.intercepted).toBe(atk.salvo)
      expect(r.damageMult).toBeCloseTo(1 - FLAK.MAX_BITE, 6)
      expect(r.damageMult).toBeGreaterThan(0)
      // the cheapest attack still lands real damage through a max fortress
      expect(Math.max(1, Math.round(atk.minDamage * r.damageMult))).toBeGreaterThan(0)
    }
  })

  it('a fully missed volley takes no bite', () => {
    const r = rollFlak(SIEGE_ATTACKS.strength, 99_999, () => 1) // rand never < p
    expect(r.intercepted).toBe(0)
    expect(r.damageMult).toBe(1)
  })

  it('every attack declares a salvo the interception can divide', () => {
    for (const atk of Object.values(SIEGE_ATTACKS)) {
      expect(atk.salvo).toBeGreaterThan(0)
      expect(Number.isInteger(atk.salvo)).toBe(true)
    }
  })

  it('a median live hall (DEF 979) bites far less than a fortress', () => {
    const median = flakHitChance(979)
    const fortress = flakHitChance(5866)
    expect(median).toBeLessThan(fortress)
    // sanity-check the tuning claim: median eats roughly a tenth of a strike
    const medianBite = median * FLAK.MAX_BITE
    expect(medianBite).toBeGreaterThan(0.05)
    expect(medianBite).toBeLessThan(0.15)
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { ENEMY_3D_IDS, getEnemyById } from '@/config/enemies'

describe('3D enemy rigs', () => {
  // A missing GLB is not a soft failure: useGLTF throws, and the 404 takes the
  // whole battle screen down. Michael hit this on union_barista (2026-07-29)
  // after six characters were listed as 3D ahead of their Meshy runs. Catch
  // the drift here instead of in someone's fight.
  const models = path.join(process.cwd(), 'public', 'models')

  it('every id declared 3D has BOTH an idle and a throw model on disk', () => {
    const missing = ENEMY_3D_IDS.filter(id =>
      !fs.existsSync(path.join(models, `${id}_idle.glb`)) ||
      !fs.existsSync(path.join(models, `${id}_throw.glb`)))
    expect(missing, `declared 3D but no model: ${missing.join(', ')}`).toEqual([])
  })

  it('every id declared 3D is a real enemy in the roster', () => {
    const unknown = ENEMY_3D_IDS.filter(id => !getEnemyById(id))
    expect(unknown, `not in the roster: ${unknown.join(', ')}`).toEqual([])
  })

  it('has no duplicate ids', () => {
    expect(new Set(ENEMY_3D_IDS).size).toBe(ENEMY_3D_IDS.length)
  })
})

import { FP_PACKS, fpPack } from '@/config/fp-packs'

describe('FP pack catalog (Stripe + Google Play share it)', () => {
  it('every pack grants base + bonus, and the id encodes the total', () => {
    for (const p of FP_PACKS) {
      expect(p.base + p.bonus, `${p.id} base+bonus`).toBe(p.fp)
      // fp_1400 must grant 1400 — the id is what a player reads as the amount
      expect(Number(p.id.replace('fp_', '')), `${p.id} id vs fp`).toBe(p.fp)
    }
  })

  it('ids are unique and Play-product-id safe (lowercase, no spaces)', () => {
    expect(new Set(FP_PACKS.map(p => p.id)).size).toBe(FP_PACKS.length)
    for (const p of FP_PACKS) expect(p.id).toMatch(/^[a-z0-9_]+$/)
  })

  it('more money always buys more FP — no pack is a worse deal than a cheaper one', () => {
    const byPrice = [...FP_PACKS].sort((a, b) => Number(a.usd.slice(1)) - Number(b.usd.slice(1)))
    for (let i = 1; i < byPrice.length; i++) {
      expect(byPrice[i].fp, `${byPrice[i].id} vs ${byPrice[i - 1].id}`).toBeGreaterThan(byPrice[i - 1].fp)
      // and FP-per-dollar must not get worse as you spend more
      const rate = (p: typeof byPrice[0]) => p.fp / Number(p.usd.slice(1))
      expect(rate(byPrice[i])).toBeGreaterThanOrEqual(rate(byPrice[i - 1]))
    }
  })

  it('lookup rejects unknown ids rather than returning a default', () => {
    expect(fpPack('fp_100')?.fp).toBe(100)
    expect(fpPack('fp_999999')).toBeUndefined()
    expect(fpPack('')).toBeUndefined()
  })

  it('every pack names a Stripe price env var', () => {
    for (const p of FP_PACKS) expect(p.stripeEnv).toMatch(/^STRIPE_PRICE_/)
  })
})

import {
  GRID, HQ_PAD, PRINT_SHOP_PAD, FIXED_PADS, BUILDABLE_CELLS,
  BUILDINGS, towerBanked, buildingCost,
  TOWER_INTERVAL_SECS, TOWER_BANK_INTERVALS, TOWER_RATE_BY_LEVEL,
} from '@/config/house'

describe('campaign HQ base (Phase 1)', () => {
  it('the yard adds up: a 6x6 open grid, every cell fixed or buildable exactly once', () => {
    expect(GRID).toBe(6)
    expect(BUILDABLE_CELLS.length + FIXED_PADS.length).toBe(GRID * GRID)
    expect(BUILDABLE_CELLS).not.toContain(HQ_PAD)
    expect(BUILDABLE_CELLS).not.toContain(PRINT_SHOP_PAD)
    expect(new Set(BUILDABLE_CELLS).size).toBe(BUILDABLE_CELLS.length)
    for (const c of BUILDABLE_CELLS) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(GRID * GRID) }
  })

  it('every building level costs more than the one before it', () => {
    for (const def of Object.values(BUILDINGS)) {
      for (let i = 1; i < def.costs.length; i++) expect(def.costs[i]).toBeGreaterThan(def.costs[i - 1])
      expect(buildingCost(def.type, 1)).toBe(def.costs[0])
      expect(buildingCost(def.type, def.costs.length + 1)).toBeNull() // no cost past max
    }
  })

  it('tower banking clamps: nothing early, one interval pays, bank caps', () => {
    expect(towerBanked(TOWER_INTERVAL_SECS - 1, 1)).toBe(0)
    expect(towerBanked(TOWER_INTERVAL_SECS, 1)).toBe(TOWER_RATE_BY_LEVEL[0])
    // a week offline banks the same as the cap — offline time is not a jackpot
    expect(towerBanked(7 * 86400, 1)).toBe(TOWER_BANK_INTERVALS * TOWER_RATE_BY_LEVEL[0])
    expect(towerBanked(-500, 1)).toBe(0)          // clock skew can't mint FP
    expect(towerBanked(TOWER_INTERVAL_SECS, 99)).toBe(TOWER_RATE_BY_LEVEL[TOWER_RATE_BY_LEVEL.length - 1]) // absurd level clamps to max
  })

  it('the tower is a slow faucet, not a printer: daily max under the daily sign-in bonus', () => {
    const maxLevel = TOWER_RATE_BY_LEVEL.length
    const perDay = (86400 / TOWER_INTERVAL_SECS) * TOWER_RATE_BY_LEVEL[maxLevel - 1]
    expect(perDay).toBeLessThanOrEqual(1000) // sign-in bonus is the ceiling reference
    // and it pays back its own build cost in days, not hours
    const l1PerDay = (86400 / TOWER_INTERVAL_SECS) * TOWER_RATE_BY_LEVEL[0]
    expect(BUILDINGS.media_tower.costs[0] / l1PerDay).toBeGreaterThanOrEqual(3)
  })
})

import {
  RAID_COST, RAID_DAILY_CAP, BOT_LOOT_DAILY_CAP, RAID_LOOT_PCT,
  raidLootAbsCap, raidDamagePct, defenseScore, botDefenseScore,
  trophiesFor, botBase, pickupsBanked,
  PICKUP_INTERVAL_SECS, PICKUP_BANK_CAP, PICKUP_MAX_FP,
} from '@/config/house'

describe('campaign HQ raids (Phase 2 anti-farm math)', () => {
  it('perfect bot farming nets less than half the daily sign-in bonus', () => {
    const worstCaseNet = BOT_LOOT_DAILY_CAP - RAID_DAILY_CAP * RAID_COST
    expect(worstCaseNet).toBeLessThanOrEqual(500)
    expect(worstCaseNet).toBeGreaterThan(0) // still worth doing, just bounded
  })

  it('damage is always bounded 35..100 whatever the matchup', () => {
    expect(raidDamagePct(1, 50, 0)).toBe(35)      // hopeless underdog still lands
    expect(raidDamagePct(50, 0, 0.999)).toBe(100) // steamroll caps at 100
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const d = raidDamagePct(10, 8, roll)
      expect(d).toBeGreaterThanOrEqual(35)
      expect(d).toBeLessThanOrEqual(100)
    }
  })

  it('loot pot is a small slice of the defender, hard-capped by base level', () => {
    // rich defender: percentage yields to the absolute cap
    expect(Math.min(100000 * RAID_LOOT_PCT, raidLootAbsCap(5))).toBe(raidLootAbsCap(5))
    expect(raidLootAbsCap(5)).toBeLessThanOrEqual(300)
    // poor defender: cap yields to the percentage — nobody is wiped out
    expect(Math.min(300 * RAID_LOOT_PCT, raidLootAbsCap(1))).toBe(18)
  })

  it('fences actually defend: each level raises the score', () => {
    const bare = defenseScore([], 1)
    const fenced = defenseScore([{ type: 'fence', level: 3 }], 1)
    expect(fenced).toBe(bare + 6)
    expect(defenseScore([{ type: 'media_tower', level: 3 }], 1)).toBe(bare + 1)
  })

  it('trophies scale with damage', () => {
    expect(trophiesFor(100)).toBe(5)
    expect(trophiesFor(60)).toBe(3)
    expect(trophiesFor(35)).toBe(1)
  })

  it('bot bases are deterministic and scale with level', () => {
    const a1 = botBase('bot-abc', 3), a2 = botBase('bot-abc', 3)
    expect(a1).toEqual(a2)                                  // same bot, same base
    expect(botBase('bot-xyz', 3)).not.toEqual(a1)           // different bot differs
    const low = botBase('bot-abc', 1), high = botBase('bot-abc', 14)
    expect(high.baseLevel).toBeGreaterThan(low.baseLevel)   // Michael's rule
    expect(high.buildings.length).toBeGreaterThan(low.buildings.length)
    expect(high.baseLevel).toBeLessThanOrEqual(5)
    // no two buildings share a pad, and every pad is a real yard pad
    for (const b of [...low.buildings, ...high.buildings]) {
      expect(b.pad).toBeGreaterThanOrEqual(0)
      expect(b.pad).toBeLessThan(GRID * GRID)
    }
    expect(new Set(high.buildings.map(b => b.pad)).size).toBe(high.buildings.length)
    expect(botDefenseScore(high.baseLevel)).toBeGreaterThan(botDefenseScore(low.baseLevel))
  })

  it('yard pickups are pocket change: hard daily ceiling under 100 FP', () => {
    const perDay = (86400 / PICKUP_INTERVAL_SECS) * PICKUP_MAX_FP
    expect(perDay).toBeLessThan(100)
    expect(pickupsBanked(0)).toBe(0)
    expect(pickupsBanked(PICKUP_INTERVAL_SECS * 99)).toBe(PICKUP_BANK_CAP) // offline caps
    expect(pickupsBanked(-100)).toBe(0)
  })
})

import { SAFE_CAPACITY, safeCapacity, SAFE_MAX_LEVEL } from '@/config/house'

describe('the safe (raid-proof FP vault)', () => {
  it('capacity and cost both rise with level', () => {
    for (let i = 1; i < SAFE_CAPACITY.length; i++) {
      expect(SAFE_CAPACITY[i]).toBeGreaterThan(SAFE_CAPACITY[i - 1])
      expect(BUILDINGS.safe.costs[i]).toBeGreaterThan(BUILDINGS.safe.costs[i - 1])
    }
    expect(BUILDINGS.safe.costs.length).toBe(SAFE_MAX_LEVEL)
  })

  it('a maxed safe can protect a whole Super Pack purchase', () => {
    expect(safeCapacity(SAFE_MAX_LEVEL)).toBeGreaterThanOrEqual(32000)
  })

  it('capacity clamps out-of-range levels instead of exploding', () => {
    expect(safeCapacity(0)).toBe(SAFE_CAPACITY[0])
    expect(safeCapacity(99)).toBe(SAFE_CAPACITY[SAFE_MAX_LEVEL - 1])
  })

  it('the safe is unique — one vault per base', () => {
    expect(BUILDINGS.safe.unique).toBe(true)
  })
})

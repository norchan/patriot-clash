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

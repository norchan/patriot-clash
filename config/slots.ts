// Slots Salute — 5-reel × 3-row, 243-ways-to-win machines with wilds, a
// scatter/bonus that triggers free spins, and a shared payout model so every
// theme has the same ~88% return (a real house edge, so slots stay an FP
// sink). Symbol art is emoji; names/themes are our own.
//
// Symbol layout per machine (index → role):
//   0 = WILD     (substitutes for every pay symbol)
//   1 = SCATTER  (BONUS — 3+ anywhere triggers free spins)
//   2..7 = pay symbols, high value → low value

export const BET_OPTIONS = [5, 25, 50, 100] as const
export type Bet = (typeof BET_OPTIONS)[number]

export const REELS = 5
export const ROWS = 3
export const WILD = 0
export const SCATTER = 1

export const FREE_SPINS_AWARD = 8   // free spins on 3+ scatter
export const FS_MULTIPLIER = 2      // every free-spin win is doubled
export const FS_RETRIGGER = 5       // extra spins on 3+ scatter during free spins
export const FS_MAX = 30            // cap on total free spins in one bonus

// Per-cell weighted pick. Rarer symbols pay more. index 0..7.
export const SYMBOL_WEIGHTS = [3, 4, 6, 8, 11, 14, 18, 22]
const WEIGHT_TOTAL = SYMBOL_WEIGHTS.reduce((a, b) => a + b, 0)

// Pay per matching symbol, as ×bet PER WAY, indexed [3ofakind, 4, 5].
export const PAYS: Record<number, [number, number, number]> = {
  2: [0.5, 2.0, 8.0],
  3: [0.3, 1.2, 5.0],
  4: [0.2, 0.8, 3.0],
  5: [0.12, 0.5, 2.0],
  6: [0.08, 0.3, 1.0],
  7: [0.05, 0.2, 0.6],
}
// Scatter pay (×bet) by count.
export const SCATTER_PAY: Record<number, number> = { 3: 1, 4: 5, 5: 25 }

// Global tuning knob — see scripts/slots_rtp.mjs. Scales every payout so the
// return-to-player lands near 88%.
export const RTP_SCALAR = 0.5

export interface SlotSymbol { emoji: string; label?: string }

export interface SlotMachine {
  id: string
  name: string
  subtitle: string
  accent: string
  accent2: string
  bg: string
  reelBg: string
  frame: string
  symbols: SlotSymbol[]  // 8: [wild, scatter, 6 pays]
  bgIcons: string[]      // scattered themed art behind the reels
}

export const MACHINES: SlotMachine[] = [
  {
    id: 'liberty-sevens',
    name: 'Liberty 7s',
    subtitle: 'Red-white-and-blue fire reels',
    accent: '#ef4444', accent2: '#f59e0b',
    bg: 'radial-gradient(ellipse at 50% -10%, #4a0f0f 0%, #1a0810 55%, #05020a 100%)',
    reelBg: 'linear-gradient(180deg, #ffffff, #dbe2ea)',
    frame: 'linear-gradient(180deg, #fbbf24, #b45309)',
    symbols: [
      { emoji: '🌟', label: 'WILD' },
      { emoji: '🎆', label: 'BONUS' },
      { emoji: '7️⃣' }, { emoji: '💎' }, { emoji: '🔔' }, { emoji: '🎰' }, { emoji: '🍋' }, { emoji: '🍒' },
    ],
    bgIcons: ['⭐', '🎆', '🎇', '🦅', '🪙', '7️⃣', '💎', '🔔'],
  },
  {
    id: 'golden-dragon',
    name: 'Golden Dragon',
    subtitle: 'Beat the drums, wake the fortune',
    accent: '#f59e0b', accent2: '#ef4444',
    bg: 'radial-gradient(ellipse at 50% -10%, #5a1606 0%, #2a0a04 55%, #120402 100%)',
    reelBg: 'linear-gradient(180deg, #fff7ed, #fde4c4)',
    frame: 'linear-gradient(180deg, #fcd34d, #b45309)',
    symbols: [
      { emoji: '🐲', label: 'WILD' },
      { emoji: '🧧', label: 'BONUS' },
      { emoji: '🐉' }, { emoji: '🏮' }, { emoji: '🥁' }, { emoji: '🪙' }, { emoji: '🎋' }, { emoji: '🍊' },
    ],
    bgIcons: ['🐉', '🐲', '🏮', '🧧', '🪙', '🥁', '☯️', '🎋'],
  },
  {
    id: 'piggy-payday',
    name: 'Piggy Payday',
    subtitle: 'Smash the bank, grab the bacon',
    accent: '#ec4899', accent2: '#a855f7',
    bg: 'radial-gradient(ellipse at 50% -10%, #4a0a3a 0%, #2a0630 55%, #100416 100%)',
    reelBg: 'linear-gradient(180deg, #fdf2f8, #f8cfe6)',
    frame: 'linear-gradient(180deg, #f9a8d4, #a21caf)',
    symbols: [
      { emoji: '💎', label: 'WILD' },
      { emoji: '🐽', label: 'BONUS' },
      { emoji: '🐷' }, { emoji: '💰' }, { emoji: '👑' }, { emoji: '💵' }, { emoji: '🪙' }, { emoji: '🍭' },
    ],
    bgIcons: ['🐷', '🪙', '💰', '💵', '🐽', '🐖', '🪙', '💲'],
  },
]

// Fixed scatter of decorative background art (deterministic so it doesn't
// reshuffle every render). Cycles through a machine's bgIcons.
export const BG_SPOTS: { top: number; left: number; size: number; rot: number; delay: number }[] = [
  { top: 6, left: 8, size: 46, rot: -18, delay: 0 },
  { top: 10, left: 82, size: 38, rot: 14, delay: 1.2 },
  { top: 20, left: 46, size: 30, rot: 8, delay: 2.1 },
  { top: 30, left: 14, size: 34, rot: 22, delay: 0.6 },
  { top: 33, left: 88, size: 44, rot: -12, delay: 1.7 },
  { top: 46, left: 4, size: 40, rot: -8, delay: 2.6 },
  { top: 50, left: 70, size: 30, rot: 18, delay: 0.9 },
  { top: 58, left: 34, size: 26, rot: -22, delay: 3.0 },
  { top: 64, left: 90, size: 38, rot: 10, delay: 1.4 },
  { top: 70, left: 10, size: 44, rot: 16, delay: 2.2 },
  { top: 76, left: 54, size: 30, rot: -14, delay: 0.4 },
  { top: 82, left: 78, size: 40, rot: 20, delay: 1.9 },
  { top: 88, left: 24, size: 34, rot: -10, delay: 2.8 },
  { top: 92, left: 64, size: 28, rot: 12, delay: 0.7 },
]

export function getMachine(id: string): SlotMachine | undefined {
  return MACHINES.find(m => m.id === id)
}

export function pickCell(rng: () => number = Math.random): number {
  let r = rng() * WEIGHT_TOTAL
  for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
    r -= SYMBOL_WEIGHTS[i]
    if (r < 0) return i
  }
  return SYMBOL_WEIGHTS.length - 1
}

// grid[reel][row]
export function spinGrid(rng: () => number = Math.random): number[][] {
  return Array.from({ length: REELS }, () =>
    Array.from({ length: ROWS }, () => pickCell(rng)))
}

export interface WinLine {
  symbol: number
  count: number              // reels matched (3..5)
  ways: number
  amount: number             // FP
  positions: [number, number][] // [reel,row]
}

export interface SpinEval {
  payout: number
  wins: WinLine[]
  scatterCount: number
  scatterPositions: [number, number][]
  freeSpins: number          // >0 if bonus triggered
}

// Evaluate one grid at a bet and win-multiplier. Pure — used by the server.
export function evaluateGrid(grid: number[][], bet: number, mult = 1): SpinEval {
  const wins: WinLine[] = []
  let rawWin = 0

  for (let s = 2; s <= 7; s++) {
    let ways = 1
    let L = 0
    const perReel: number[][] = []
    for (let r = 0; r < REELS; r++) {
      const rows: number[] = []
      for (let row = 0; row < ROWS; row++) {
        if (grid[r][row] === s || grid[r][row] === WILD) rows.push(row)
      }
      if (rows.length === 0) break
      ways *= rows.length
      L++
      perReel.push(rows)
    }
    if (L >= 3) {
      const base = PAYS[s][L - 3]
      const amount = Math.floor(bet * base * ways * RTP_SCALAR * mult)
      if (amount > 0) {
        const positions: [number, number][] = []
        for (let r = 0; r < L; r++) for (const row of perReel[r]) positions.push([r, row])
        rawWin += amount
        wins.push({ symbol: s, count: L, ways, amount, positions })
      }
    }
  }

  const scatterPositions: [number, number][] = []
  for (let r = 0; r < REELS; r++)
    for (let row = 0; row < ROWS; row++)
      if (grid[r][row] === SCATTER) scatterPositions.push([r, row])
  const scatterCount = scatterPositions.length

  let freeSpins = 0
  if (scatterCount >= 3) {
    const sp = SCATTER_PAY[Math.min(scatterCount, 5)] ?? 0
    rawWin += Math.floor(bet * sp * RTP_SCALAR * mult)
    freeSpins = FREE_SPINS_AWARD
  }

  return { payout: rawWin, wins, scatterCount, scatterPositions, freeSpins }
}

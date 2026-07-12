// Slots Salute — three original 3-reel machines. Symbol art is plain emoji;
// names/themes are our own. Reel math is shared so every machine has the same
// ~88% return (a gentle house edge, so slots stay an FP sink). Index 0 is the
// jackpot symbol (rarest), index 5 the common low-payer.

export const BET_OPTIONS = [5, 25, 50, 100] as const
export type Bet = (typeof BET_OPTIONS)[number]

// Per-reel symbol weights (must sum to REEL_TOTAL). Rarer = bigger pay.
export const REEL_WEIGHTS = [4, 7, 11, 16, 26, 36]
export const REEL_TOTAL = REEL_WEIGHTS.reduce((a, b) => a + b, 0) // 100

// Multiplier of the bet for three-of-a-kind, by symbol index.
export const PAY3 = [200, 80, 40, 20, 10, 4]
// Multiplier for exactly two-of-a-kind, by symbol index (0 = no pair pay).
export const PAY2 = [8, 4, 2, 1, 0, 0.5]

export interface SlotSymbol { emoji: string; label: string }

export interface SlotMachine {
  id: string
  name: string
  subtitle: string
  accent: string        // neon accent color
  bg: string            // page background gradient
  reelBg: string        // reel window background
  symbols: SlotSymbol[] // exactly 6, index 0 = jackpot
}

export const MACHINES: SlotMachine[] = [
  {
    id: 'liberty-sevens',
    name: 'Liberty 7s',
    subtitle: 'Classic red-white-and-blue reels',
    accent: '#ef4444',
    bg: 'radial-gradient(ellipse at 50% 0%, #3b0a0a 0%, #14060a 60%, #050208 100%)',
    reelBg: 'linear-gradient(180deg, #f8fafc, #cbd5e1)',
    symbols: [
      { emoji: '7️⃣', label: 'Lucky 7' },
      { emoji: '💎', label: 'Diamond' },
      { emoji: '🔔', label: 'Bell' },
      { emoji: '⭐', label: 'Star' },
      { emoji: '🍋', label: 'Lemon' },
      { emoji: '🍒', label: 'Cherry' },
    ],
  },
  {
    id: 'golden-dragon',
    name: 'Golden Dragon',
    subtitle: 'Beat the drums, wake the fortune',
    accent: '#f59e0b',
    bg: 'radial-gradient(ellipse at 50% 0%, #4a1206 0%, #2a0a04 55%, #120402 100%)',
    reelBg: 'linear-gradient(180deg, #fff7ed, #fed7aa)',
    symbols: [
      { emoji: '🐉', label: 'Dragon' },
      { emoji: '🧧', label: 'Red Envelope' },
      { emoji: '🥁', label: 'Drum' },
      { emoji: '🏮', label: 'Lantern' },
      { emoji: '🪙', label: 'Gold Coin' },
      { emoji: '🍊', label: 'Orange' },
    ],
  },
  {
    id: 'piggy-payday',
    name: 'Piggy Payday',
    subtitle: 'Smash the bank, grab the bacon',
    accent: '#ec4899',
    bg: 'radial-gradient(ellipse at 50% 0%, #4a0a3a 0%, #2a0630 55%, #100416 100%)',
    reelBg: 'linear-gradient(180deg, #fdf2f8, #fbcfe8)',
    symbols: [
      { emoji: '🐷', label: 'Piggy' },
      { emoji: '💰', label: 'Money Bag' },
      { emoji: '👑', label: 'Crown' },
      { emoji: '💵', label: 'Cash' },
      { emoji: '🪙', label: 'Coin' },
      { emoji: '🐽', label: 'Snout' },
    ],
  },
]

export function getMachine(id: string): SlotMachine | undefined {
  return MACHINES.find(m => m.id === id)
}

// Weighted pick of a symbol index 0..5 using REEL_WEIGHTS.
export function pickSymbol(rng: () => number = Math.random): number {
  let r = rng() * REEL_TOTAL
  for (let i = 0; i < REEL_WEIGHTS.length; i++) {
    r -= REEL_WEIGHTS[i]
    if (r < 0) return i
  }
  return REEL_WEIGHTS.length - 1
}

// Given three reel symbol indices and a bet, return the payout in FP.
export function evaluateSpin(reels: number[], bet: number): { mult: number; payout: number } {
  const [a, b, c] = reels
  let mult = 0
  if (a === b && b === c) {
    mult = PAY3[a]
  } else {
    // at most one pair among three positions
    const pair = a === b ? a : a === c ? a : b === c ? b : -1
    if (pair >= 0) mult = PAY2[pair]
  }
  return { mult, payout: Math.floor(bet * mult) }
}

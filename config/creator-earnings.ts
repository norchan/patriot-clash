// Creator earnings configuration — single source of truth for payouts
export const CREATOR_EARNINGS = {
  USD_PER_1000_IMPRESSIONS: 0.30,
  MIN_WITHDRAW_USD: 5.00,
  HOLD_DAYS: 30,

  // Derived (calculated, not config)
  get MIN_IMPRESSIONS(): number {
    return Math.ceil((this.MIN_WITHDRAW_USD / this.USD_PER_1000_IMPRESSIONS) * 1000)
  },
} as const

export function estimatedEarnings(impressions: number): string {
  const usd = (impressions / 1000) * CREATOR_EARNINGS.USD_PER_1000_IMPRESSIONS
  return usd.toFixed(2)
}

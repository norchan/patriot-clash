// Creator earnings configuration — single source of truth for payouts.
//
// RULES (Michael, 2026-07-25):
// 1. The rate is PROMOTIONAL/ADJUSTABLE — all copy must say "current rate",
//    never promise it as permanent. Change it here and every screen follows.
// 2. HARD RULE for impression tracking (when it's built): an impression only
//    counts when the content is opened on a screen that RENDERED AN AD.
//    No ad shown = no impression = no payout. We never pay on views that
//    didn't earn ad revenue. Seed/bot counts must never enter the payable
//    counter. Michael (2026-07-25): the ad revenue comes from the psubs and
//    psub-related pages — someone clicks a post, its page loads an ad, THAT
//    is the shared impression.
export const CREATOR_EARNINGS = {
  USD_PER_1000_IMPRESSIONS: 0.10,
  MIN_WITHDRAW_USD: 10.00,
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

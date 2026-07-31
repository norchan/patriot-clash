// FP PACK CATALOG — the single source of truth for what a purchase grants,
// shared by the shop UI, the Stripe checkout route and the Google Play
// verification route.
//
// It lives here because the same numbers previously existed in three places
// (shop page, checkout route, Stripe dashboard) and now a fourth store is
// involved. A pack whose FP amount disagrees between two payment paths is a
// money bug, and money bugs that only appear on one platform are the worst
// kind to find. `fp` is the TOTAL granted, bonus included.
//
// PLAY STORE: `id` doubles as the Google Play product ID. Create each one in
// Play Console → Monetise → In-app products with EXACTLY this ID and the
// matching price, or the purchase will verify against nothing.

export interface FpPack {
  /** internal id AND the Google Play product id */
  id: string
  name: string
  /** TOTAL fp granted (base + bonus) */
  fp: number
  /** base amount shown before the bonus call-out */
  base: number
  bonus: number
  usd: string
  emoji: string
  featured?: boolean
  /** Stripe price id env var name — Stripe keeps its own price objects */
  stripeEnv: string
}

export const FP_PACKS: FpPack[] = [
  { id: 'fp_100',   name: 'Starter Pack', fp: 100,   base: 100,   bonus: 0,     usd: '$0.99',  emoji: '⚡',   stripeEnv: 'STRIPE_PRICE_FP_100' },
  { id: 'fp_600',   name: 'Value Pack',   fp: 600,   base: 500,   bonus: 100,   usd: '$4.99',  emoji: '⚡⚡', featured: true, stripeEnv: 'STRIPE_PRICE_FP_600' },
  { id: 'fp_1400',  name: 'Power Pack',   fp: 1400,  base: 1000,  bonus: 400,   usd: '$9.99',  emoji: '🔋',   stripeEnv: 'STRIPE_PRICE_FP_1400' },
  { id: 'fp_3200',  name: 'Elite Pack',   fp: 3200,  base: 2000,  bonus: 1200,  usd: '$19.99', emoji: '🔥',   stripeEnv: 'STRIPE_PRICE_FP_3200' },
  { id: 'fp_32000', name: 'Super Pack',   fp: 32000, base: 20000, bonus: 12000, usd: '$99.99', emoji: '👑',   stripeEnv: 'STRIPE_PRICE_FP_32000' },
]

export const fpPack = (id: string): FpPack | undefined => FP_PACKS.find(p => p.id === id)

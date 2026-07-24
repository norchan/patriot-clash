// Reels ordering (A1 brief Phase 4): SIMPLE ranking now, real algorithm
// later. This is deliberately v1 — recency-first with a light score boost and
// an optional party tilt. When a smarter "For You" model exists, it replaces
// scoreReel() and every caller keeps working. No ML, and nothing here should
// ever be described as one.

export interface RankableReel {
  id: string
  created_at: string
  score?: number | null
  party?: string | null
}

export interface RankCtx {
  /** signed-in viewer's party — same-party clips get a LIGHT tilt, not a bubble */
  party?: string | null
  /** video/post ids the viewer already watched (client keeps these) — demoted to the tail */
  seenIds?: Set<string>
}

function scoreReel(r: RankableReel, ctx: RankCtx, now: number): number {
  const ageHours = Math.max(0, (now - +new Date(r.created_at)) / 3.6e6)
  // half-life ~18h: fresh floats, two-day-old sinks (posts expire at 48h anyway)
  const recency = Math.pow(0.5, ageHours / 18)
  const engagement = Math.log10((r.score ?? 0) + 1) * 0.15
  const partyTilt = ctx.party && r.party && r.party === ctx.party ? 0.08 : 0
  return recency + engagement + partyTilt
}

/** Order a reel list for the pager: unseen first (by score), seen at the tail
 *  (same ordering within). Stable inputs → stable output. */
export function rankReels<T extends RankableReel>(items: T[], ctx: RankCtx = {}): T[] {
  const now = Date.now()
  const scored = items.map(r => ({ r, s: scoreReel(r, ctx, now), seen: ctx.seenIds?.has(r.id) ?? false }))
  scored.sort((a, b) => (Number(a.seen) - Number(b.seen)) || (b.s - a.s))
  return scored.map(x => x.r)
}

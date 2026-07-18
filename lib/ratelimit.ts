// ── Cheap per-instance rate limiter ──────────────────────────────────────────
// Sliding-window counter in process memory. On serverless this is per warm
// instance, not global — so it's a burst guard (button-mash, runaway client
// loop, curl spam), not a hard quota. That's the right tradeoff here: the
// money math is already server-authoritative, we just want abuse to be
// annoying and accidental loops to be harmless, without a DB roundtrip.

const buckets = new Map<string, number[]>()
let lastSweep = Date.now()

/**
 * Returns true if `key` has exceeded `max` calls in the past `windowMs`.
 * Records the current call either way.
 */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()

  // occasional sweep so long-running instances don't accumulate dead keys
  if (now - lastSweep > 60_000) {
    lastSweep = now
    for (const [k, times] of buckets) {
      if (times.length === 0 || now - times[times.length - 1] > windowMs) buckets.delete(k)
    }
  }

  const times = (buckets.get(key) ?? []).filter(t => now - t < windowMs)
  times.push(now)
  buckets.set(key, times)
  return times.length > max
}

/** 429 JSON response for a tripped limit. */
export function rateLimitResponse() {
  return Response.json(
    { error: 'RATE_LIMITED', message: 'Slow down — too many requests.' },
    { status: 429 },
  )
}

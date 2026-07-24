// Shared uniqueness helpers for bot content (boards polish Phase C/D).
// One home for the same-story detector the news reporters grew separately,
// plus text-similarity gates for comments/replies — Michael's hard rule:
// every bot post, comment, and reply must be unique; prefer skip over dupe.

/** Meaningful lowercase tokens of a headline (subject words strippable). */
export function titleTokens(t: string, ignore?: Set<string>): Set<string> {
  return new Set(
    t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !ignore?.has(w)))
}

/**
 * Same-story detection: token overlap between normalized headlines.
 * "Vikings release TE Josh Oliver" vs "Vikings expected to release
 * injury-riddled TE Josh Oliver - ESPN" → duplicate. Pass the board's
 * subject words (team/state name) as `ignore` — they're shared by every
 * headline on that board; paraphrase-tolerant 50% overlap flags the match.
 */
export function sameStory(a: string, b: string, ignore?: Set<string>): boolean {
  const ta = titleTokens(a, ignore), tb = titleTokens(b, ignore)
  if (!ta.size || !tb.size) return false
  let hit = 0
  for (const w of ta) if (tb.has(w)) hit++
  return hit / Math.min(ta.size, tb.size) >= 0.5
}

/** Canonical form for comparing short human-ish texts (comments/replies). */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Near-duplicate gate for comments/replies. Exact normalized match always
 * trips it; otherwise token overlap ≥ threshold of the smaller set. Very
 * short texts (under 4 tokens) only match near-exactly — tiny token sets
 * make overlap ratios meaningless.
 */
export function tooSimilar(a: string, b: string, threshold = 0.7): boolean {
  const na = normalizeText(a), nb = normalizeText(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const ta = new Set(na.split(' ').filter(w => w.length > 1))
  const tb = new Set(nb.split(' ').filter(w => w.length > 1))
  if (!ta.size || !tb.size) return false
  let hit = 0
  for (const w of ta) if (tb.has(w)) hit++
  const ratio = hit / Math.min(ta.size, tb.size)
  return Math.min(ta.size, tb.size) < 4 ? ratio >= 0.99 : ratio >= threshold
}

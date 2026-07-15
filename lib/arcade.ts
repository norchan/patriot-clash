import { createSupabaseAdminClient } from '@/lib/supabase-server'

// ── Arcade anti-farm (server-owned sessions + daily caps) ────────────────────
// Free arcade games only PAY OUT, so without guards a script can farm FP.
// Every reward call must reference a server-created session; awards are capped
// by (a) a per-session rate tied to real elapsed play time and (b) a shared
// daily cap across the free games. Slots is excluded — it takes a bet and is
// already server-authoritative.

export const ARCADE_DAILY_CAP = 5000        // FP/day across all free arcade games
export const SESSION_RATE_PER_MIN = 900     // max FP a session can emit per minute of play
export const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000

export const FREE_GAMES = ['landslide', 'tetkris'] as const
export type FreeGame = (typeof FREE_GAMES)[number]

/**
 * Validates the session and clamps `requested` FP by the session rate and the
 * daily cap, then atomically records the award on the session.
 * Returns the amount actually allowed (0 = capped out / invalid session).
 */
export async function clampArcadeAward(
  profileId: string,
  game: FreeGame,
  sessionId: unknown,
  requested: number,
): Promise<{ allowed: number; reason?: string }> {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return { allowed: 0, reason: 'NO_SESSION' }
  }
  const admin = createSupabaseAdminClient()

  const { data: session } = await admin
    .from('arcade_sessions')
    .select('id, game, awarded_fp, created_at')
    .eq('id', sessionId)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (!session || session.game !== game) return { allowed: 0, reason: 'NO_SESSION' }

  const ageMs = Date.now() - new Date(session.created_at).getTime()
  if (ageMs > SESSION_MAX_AGE_MS) return { allowed: 0, reason: 'SESSION_EXPIRED' }

  // per-session rate: you can't have earned faster than real play time allows
  const rateBudget = Math.floor((ageMs / 60000 + 0.5) * SESSION_RATE_PER_MIN) - session.awarded_fp

  // shared daily cap across the free games
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
  const { data: todays } = await admin
    .from('arcade_sessions')
    .select('awarded_fp')
    .eq('profile_id', profileId)
    .gte('created_at', dayStart.toISOString())
  const earnedToday = (todays ?? []).reduce((s, r) => s + (r.awarded_fp ?? 0), 0)
  const dailyBudget = ARCADE_DAILY_CAP - earnedToday

  const allowed = Math.max(0, Math.min(requested, rateBudget, dailyBudget))
  if (allowed > 0) {
    await admin
      .from('arcade_sessions')
      .update({ awarded_fp: session.awarded_fp + allowed, last_event_at: new Date().toISOString() })
      .eq('id', session.id)
  }
  return {
    allowed,
    reason: allowed === 0 ? (dailyBudget <= 0 ? 'DAILY_CAP' : 'RATE_CAP') : undefined,
  }
}

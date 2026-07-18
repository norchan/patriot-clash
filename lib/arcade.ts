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
 * Pure clamp math (mirrors the SQL in record_arcade_award) — exported so the
 * test suite can pin the budget behavior without a database.
 */
export function computeArcadeBudget(
  ageMs: number,
  sessionAwarded: number,
  earnedToday: number,
  requested: number,
): { allowed: number; reason?: string } {
  if (ageMs > SESSION_MAX_AGE_MS) return { allowed: 0, reason: 'SESSION_EXPIRED' }
  const rateBudget = Math.floor((ageMs / 60000 + 0.5) * SESSION_RATE_PER_MIN) - sessionAwarded
  const dailyBudget = ARCADE_DAILY_CAP - earnedToday
  const allowed = Math.max(0, Math.min(requested, rateBudget, dailyBudget))
  return {
    allowed,
    reason: allowed === 0 ? (dailyBudget <= 0 ? 'DAILY_CAP' : 'RATE_CAP') : undefined,
  }
}

/**
 * Validates the session and clamps `requested` FP by the session rate and the
 * daily cap, then records the award on the session. The whole
 * check-clamp-record runs as ONE database transaction under a per-profile
 * lock (record_arcade_award), so parallel reward calls can't both pass the
 * same budget and double-pay.
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

  const { data, error } = await admin.rpc('record_arcade_award', {
    p_profile_id: profileId,
    p_session_id: sessionId,
    p_game: game,
    p_requested: Math.max(0, Math.floor(requested)),
    p_rate_per_min: SESSION_RATE_PER_MIN,
    p_daily_cap: ARCADE_DAILY_CAP,
    p_max_age_ms: SESSION_MAX_AGE_MS,
  })
  if (error) {
    console.error('record_arcade_award error:', error)
    return { allowed: 0, reason: 'ERROR' }
  }
  const row = Array.isArray(data) ? data[0] : data
  return { allowed: row?.allowed ?? 0, reason: row?.reason ?? undefined }
}

import type { SupabaseClient } from '@supabase/supabase-js'

// Single source of truth for block enforcement. Every player-to-player
// interaction route (chat, challenges, future features) must call this —
// hand-copying the .or() query per route is how the PvP challenge route
// originally shipped without any block check at all.
export async function isBlockedEitherWay(
  admin: SupabaseClient,
  playerA: string,
  playerB: string
): Promise<boolean> {
  const { data } = await admin
    .from('player_blocks')
    .select('blocker_id')
    .or(
      `and(blocker_id.eq.${playerA},blocked_id.eq.${playerB}),` +
      `and(blocker_id.eq.${playerB},blocked_id.eq.${playerA})`
    )
    .limit(1)
    .maybeSingle()

  return !!data
}

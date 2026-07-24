import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/pvp/queue — the player's QUEUED fights: armed challenges (either
// side) still inside their window. Powers the Fight Lobby list; tapping one
// enters the ring.
export async function GET(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: fights } = await admin
      .from('pvp_challenges')
      .select('id, challenger_id, defender_id, challenger_username, defender_username, challenger_party, defender_party, fp_stake, accepted_at, expires_at, defender_ready_at')
      .or(`challenger_id.eq.${profile.id},defender_id.eq.${profile.id}`)
      .eq('status', 'accepted')
      .gt('expires_at', new Date().toISOString())
      .order('accepted_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      fights: (fights ?? []).map(f => {
        const iAmChallenger = f.challenger_id === profile.id
        return {
          id: f.id,
          opponent: iAmChallenger ? f.defender_username : f.challenger_username,
          opponent_party: iAmChallenger ? f.defender_party : f.challenger_party,
          i_am_challenger: iAmChallenger,
          fp_stake: f.fp_stake,
          accepted_at: f.accepted_at,
          expires_at: f.expires_at,
          // best-known "they're in the ring" signal (defender marks on load)
          opponent_waiting: iAmChallenger ? !!f.defender_ready_at : true,
        }
      }),
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ fights: [] })
  }
}

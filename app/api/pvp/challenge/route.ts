import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isBlockedEitherWay } from '@/lib/blocks'

const FP_STAKE = 50

// =============================================================================
// POST /api/pvp/challenge
// Send a PvP battle challenge to another player.
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { defender_id } = await req.json()

    if (!defender_id) {
      return NextResponse.json({ error: 'defender_id required' }, { status: 400 })
    }

    if (defender_id === profile.id) {
      return NextResponse.json({ error: 'Cannot challenge yourself' }, { status: 400 })
    }

    // Challenging is FREE — the loser pays afterward (up to FP_STAKE, or
    // everything they have if that's less). So no pre-fight balance gate.

    // Blocked players cannot challenge each other
    if (await isBlockedEitherWay(admin, profile.id, defender_id)) {
      return NextResponse.json({ error: 'Cannot challenge this player' }, { status: 403 })
    }

    const { data: defender } = await admin
      .from('profiles')
      .select('id, username, party, fp_balance, clerk_user_id')
      .eq('id', defender_id)
      .single()

    if (!defender) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const isBot = defender.clerk_user_id?.startsWith('bot_')

    // Block duplicate pending challenges between these two players
    const { data: existing } = await admin
      .from('pvp_challenges')
      .select('id')
      .or(
        `and(challenger_id.eq.${profile.id},defender_id.eq.${defender_id}),` +
        `and(challenger_id.eq.${defender_id},defender_id.eq.${profile.id})`
      )
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'A challenge is already pending between you two' }, { status: 400 })
    }

    const { data: challenge, error } = await admin
      .from('pvp_challenges')
      .insert({
        challenger_id: profile.id,
        defender_id: defender.id,
        challenger_username: profile.username,
        defender_username: defender.username,
        challenger_party: profile.party,
        defender_party: defender.party,
        fp_stake: FP_STAKE,
        // Bots auto-accept: the challenge is immediately ARMED — the
        // challenger fights it live on the fight screen
        status: isBot ? 'accepted' : 'pending',
        accepted_at: isBot ? new Date().toISOString() : null,
        expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('pvp_challenges insert error:', error)
      return NextResponse.json({ error: 'Failed to create challenge' }, { status: 500 })
    }

    return NextResponse.json({ id: challenge.id, status: challenge.status, defender_username: defender.username })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/pvp/challenge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

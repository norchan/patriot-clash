import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isBlockedEitherWay } from '@/lib/blocks'
import { notify } from '@/lib/notify'

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

    // Block duplicate live challenges between these two players
    const { data: existing } = await admin
      .from('pvp_challenges')
      .select('id, status')
      .or(
        `and(challenger_id.eq.${profile.id},defender_id.eq.${defender_id}),` +
        `and(challenger_id.eq.${defender_id},defender_id.eq.${profile.id})`
      )
      .in('status', ['pending', 'accepted'])
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existing) {
      // a fight is already live between these two — send them into IT instead
      // of erroring (double-tapping a shared fight link must not dead-end)
      return NextResponse.json({ id: existing.id, status: existing.status, existing: true })
    }

    // EVERY challenge arms instantly (Michael 2026-07-23: anyone can fight —
    // no accept step). The challenger goes straight to the ring; the defender
    // gets pulled in by their map poll / notification. If they never show,
    // the live fight's 20s no-show ghost takes over, so the fight always runs.
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
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('pvp_challenges insert error:', error)
      return NextResponse.json({ error: 'Failed to create challenge' }, { status: 500 })
    }

    if (!isBot) {
      await notify(admin, {
        profileId: defender.id,
        type: 'pvp',
        title: `⚔️ ${profile.username} called you out!`,
        body: `The fight is ON — ${FP_STAKE} FP at stake. Tap to jump in!`,
        link: `/battle/pvp?id=${challenge.id}`,
      })
    }

    return NextResponse.json({ id: challenge.id, status: challenge.status, defender_username: defender.username })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/pvp/challenge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fighterLevel, sanitizeFighter } from '@/lib/fighter'
import { headMeta } from '@/config/heads'

// GET /api/public/fight/challenge/[challengeId] — the guest client's window
// onto its REAL street fight (guests can't call the authed /api/pvp/[id]).
// ONLY exposes challenges whose challenger is the shared StreetChallenger
// identity; everything else 404s.

function partyHead(headId?: string | null, party?: string | null): string | null {
  if (!headId) return null
  const hp = headMeta(headId)?.party
  return hp && hp !== party ? null : headId
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ challengeId: string }> }
) {
  try {
    const { challengeId } = await params
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const admin = createSupabaseAdminClient()

    const { data: challenge } = await admin
      .from('pvp_challenges').select('*').eq('id', challengeId).maybeSingle()
    if (!challenge) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: guest } = await admin
      .from('profiles').select('id').eq('clerk_user_id', 'guest_street').maybeSingle()
    if (!guest || challenge.challenger_id !== guest.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // abandoned armed street fights cancel after 10 min, same as real ones
    if (challenge.status === 'accepted' && challenge.accepted_at
      && Date.now() - new Date(challenge.accepted_at).getTime() > 10 * 60_000) {
      await admin.from('pvp_challenges').update({ status: 'cancelled' }).eq('id', challengeId).eq('status', 'accepted')
      return NextResponse.json({ ...challenge, status: 'cancelled' })
    }

    if (['accepted', 'resolving', 'completed'].includes(challenge.status)) {
      const { data: d } = await admin
        .from('profiles')
        .select('id, total_battles_won, fighter, pvp_fighter, head_id, party, clerk_user_id')
        .eq('id', challenge.defender_id).single()
      return NextResponse.json({
        ...challenge,
        challenger_level: 1,
        defender_level: fighterLevel(d?.total_battles_won ?? 0),
        challenger_fighter: sanitizeFighter(null, 'guest'),
        defender_fighter: sanitizeFighter(d?.fighter, challenge.defender_id),
        challenger_pvp_fighter: 'fighter1',
        defender_pvp_fighter: d?.pvp_fighter ?? 'fighter1',
        challenger_head_id: null,
        defender_head_id: partyHead(d?.head_id, d?.party),
        challenger_is_bot: false,
        defender_is_bot: false, // the whole point: a real human on the other side
      })
    }
    return NextResponse.json(challenge)
  } catch (err) {
    console.error('GET /api/public/fight/challenge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

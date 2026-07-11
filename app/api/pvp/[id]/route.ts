import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fighterLevel, sanitizeFighter } from '@/lib/fighter'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: challenge, error } = await admin
      .from('pvp_challenges')
      .select('*')
      .eq('id', id)
      .or(`challenger_id.eq.${profile.id},defender_id.eq.${profile.id}`)
      .single()

    if (error || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status === 'pending' && new Date(challenge.expires_at) < new Date()) {
      await admin.from('pvp_challenges').update({ status: 'expired' }).eq('id', id)
      return NextResponse.json({ ...challenge, status: 'expired' })
    }

    // Armed fights the challenger walked away from get cancelled — no FP
    // ever moved, so nothing to unwind
    if (challenge.status === 'accepted' && challenge.accepted_at
      && Date.now() - new Date(challenge.accepted_at).getTime() > 10 * 60_000) {
      await admin.from('pvp_challenges').update({ status: 'cancelled' }).eq('id', id).eq('status', 'accepted')
      return NextResponse.json({ ...challenge, status: 'cancelled' })
    }

    // Usernames/parties are denormalized onto the row at insert time — no
    // extra profile queries needed (this route is polled every 3s)...
    // EXCEPT armed/settled fights: the fight screen needs both fighters'
    // levels and designs — including AFTER settlement (the post-fight
    // refetch previously dropped the designs, morphing the winner into a
    // random default fighter at the victory screen)
    if (['accepted', 'resolving', 'completed'].includes(challenge.status)) {
      const [{ data: c }, { data: d }] = await Promise.all([
        admin.from('profiles').select('id, total_battles_won, fighter, clerk_user_id').eq('id', challenge.challenger_id).single(),
        admin.from('profiles').select('id, total_battles_won, fighter, clerk_user_id').eq('id', challenge.defender_id).single(),
      ])
      return NextResponse.json({
        ...challenge,
        challenger_level: fighterLevel(c?.total_battles_won ?? 0),
        defender_level: fighterLevel(d?.total_battles_won ?? 0),
        challenger_fighter: sanitizeFighter(c?.fighter, challenge.challenger_id),
        defender_fighter: sanitizeFighter(d?.fighter, challenge.defender_id),
        challenger_is_bot: !!c?.clerk_user_id?.startsWith('bot_'),
        defender_is_bot: !!d?.clerk_user_id?.startsWith('bot_'),
      })
    }

    return NextResponse.json(challenge)

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/pvp/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

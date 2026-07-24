import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { notify } from '@/lib/notify'
import { rateLimited } from '@/lib/ratelimit'

// POST /api/public/fight/[id]/start — a GUEST accepted the fight link.
// Creates a REAL pvp challenge from the shared StreetChallenger identity vs
// the link owner (stake 0), so the owner's push deep-links into an actual
// live ring and both sides fight for real (Michael 2026-07-23: "allow me to
// join the fight against the person"). If a street fight vs this owner is
// already live, the caller falls back to the local demo instead.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (rateLimited(`gstart:${id}`, 6, 60_000)) return NextResponse.json({ demo: true })
    const admin = createSupabaseAdminClient()

    const [{ data: owner }, { data: guest }] = await Promise.all([
      admin.from('profiles').select('id, username, party').eq('id', id).maybeSingle(),
      admin.from('profiles').select('id, username').eq('clerk_user_id', 'guest_street').maybeSingle(),
    ])
    if (!owner || !guest) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // one live street fight per owner at a time — extra guests get the demo
    const { data: existing } = await admin
      .from('pvp_challenges')
      .select('id')
      .eq('challenger_id', guest.id)
      .eq('defender_id', owner.id)
      .eq('status', 'accepted')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (existing) return NextResponse.json({ demo: true })

    const guestParty = owner.party === 'democrat' ? 'republican' : 'democrat'
    const { data: challenge, error } = await admin
      .from('pvp_challenges')
      .insert({
        challenger_id: guest.id,
        defender_id: owner.id,
        challenger_username: 'Street Challenger',
        defender_username: owner.username,
        challenger_party: guestParty,
        defender_party: owner.party,
        fp_stake: 0, // anonymous fights carry no FP
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
    if (error || !challenge) {
      console.error('street fight insert failed:', error)
      return NextResponse.json({ demo: true })
    }

    // awaited — serverless kills un-awaited work at response time
    await notify(admin, {
      profileId: owner.id,
      type: 'pvp',
      title: '🥊 A Street Challenger is IN YOUR RING!',
      body: 'Someone from your fight link wants YOU, live. The ring holds ~75 seconds — tap to fight!',
      link: `/battle/pvp?id=${challenge.id}`,
    })

    return NextResponse.json({ id: challenge.id })
  } catch (err) {
    console.error('POST /api/public/fight/start error:', err)
    return NextResponse.json({ demo: true })
  }
}

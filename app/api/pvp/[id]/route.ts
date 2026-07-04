import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

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

    // For completed challenges, enrich with player details so the battle page
    // can display usernames and parties without extra round-trips
    if (challenge.status === 'completed') {
      const [{ data: challenger }, { data: defender }] = await Promise.all([
        admin.from('profiles').select('username, party').eq('id', challenge.challenger_id).single(),
        admin.from('profiles').select('username, party').eq('id', challenge.defender_id).single(),
      ])
      return NextResponse.json({
        ...challenge,
        challenger_username: challenger?.username ?? 'Player',
        challenger_party: challenger?.party ?? 'democrat',
        defender_username: defender?.username ?? 'Player',
        defender_party: defender?.party ?? 'republican',
      })
    }

    return NextResponse.json(challenge)

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/pvp/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    // Usernames/parties are denormalized onto the row at insert time — no
    // extra profile queries needed (this route is polled every 3s)
    return NextResponse.json(challenge)

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/pvp/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

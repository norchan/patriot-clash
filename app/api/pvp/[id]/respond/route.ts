import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { accept } = await req.json()

    const { data: challenge } = await admin
      .from('pvp_challenges')
      .select('*')
      .eq('id', id)
      .eq('defender_id', profile.id)
      .eq('status', 'pending')
      .single()

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found or already resolved' }, { status: 404 })
    }

    if (new Date(challenge.expires_at) < new Date()) {
      await admin.from('pvp_challenges').update({ status: 'expired' }).eq('id', id)
      return NextResponse.json({ error: 'Challenge has expired' }, { status: 400 })
    }

    if (!accept) {
      await admin.from('pvp_challenges')
        .update({ status: 'declined' })
        .eq('id', id)
        .eq('status', 'pending')
      return NextResponse.json({ status: 'declined' })
    }

    // Accepting ARMS the fight: the challenger plays it live on the fight
    // screen (the defender's side is fought by their fighter at their level).
    // Atomic pending→accepted so concurrent accepts can't double-arm.
    const { data: claimed } = await admin
      .from('pvp_challenges')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (!claimed) {
      return NextResponse.json({ error: 'Challenge is already being resolved' }, { status: 409 })
    }

    return NextResponse.json({ status: 'accepted' })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/pvp/[id]/respond error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

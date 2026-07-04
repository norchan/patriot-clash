import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/chat/request — send a chat request to another player
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { receiver_id } = await req.json()

    if (!receiver_id || receiver_id === profile.id) {
      return NextResponse.json({ error: 'Invalid receiver' }, { status: 400 })
    }

    // Receiver must have messaging enabled
    const { data: receiver } = await admin
      .from('profiles')
      .select('id, username, allow_messages')
      .eq('id', receiver_id)
      .single()

    if (!receiver?.allow_messages) {
      return NextResponse.json({ error: 'That player has messages turned off' }, { status: 403 })
    }

    // Check neither player has blocked the other
    const { data: block } = await admin
      .from('player_blocks')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${profile.id},blocked_id.eq.${receiver_id}),` +
        `and(blocker_id.eq.${receiver_id},blocked_id.eq.${profile.id})`
      )
      .limit(1)
      .maybeSingle()

    if (block) {
      return NextResponse.json({ error: 'Cannot message this player' }, { status: 403 })
    }

    // Cancel any existing pending request between these two
    await admin
      .from('chat_requests')
      .update({ status: 'declined' })
      .eq('sender_id', profile.id)
      .eq('receiver_id', receiver_id)
      .eq('status', 'pending')

    const { data: request, error } = await admin
      .from('chat_requests')
      .insert({ sender_id: profile.id, receiver_id })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ id: request.id })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

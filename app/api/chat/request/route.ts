import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isBlockedEitherWay } from '@/lib/blocks'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'

// POST /api/chat/request — send a chat request to another player
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`chatreq:${profile.id}`, 8, 60_000)) return rateLimitResponse()
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
    if (await isBlockedEitherWay(admin, profile.id, receiver_id)) {
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

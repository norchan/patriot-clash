import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

function conversationId(a: string, b: string) {
  return [a, b].sort().join('_')
}

// GET /api/chat/[userId] — fetch message thread with a player
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { userId } = await params

    const convId = conversationId(profile.id, userId)

    const { data: messages } = await admin
      .from('direct_messages')
      .select('id, sender_id, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(100)

    return NextResponse.json({ messages: messages ?? [] })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/chat/[userId] — send a message to a player
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { userId } = await params
    const { content } = await req.json()

    if (!content?.trim() || content.length > 500) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
    }

    // Verify no block in either direction
    const { data: block } = await admin
      .from('player_blocks')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${profile.id},blocked_id.eq.${userId}),` +
        `and(blocker_id.eq.${userId},blocked_id.eq.${profile.id})`
      )
      .limit(1)
      .maybeSingle()

    if (block) {
      return NextResponse.json({ error: 'Cannot message this player' }, { status: 403 })
    }

    const convId = conversationId(profile.id, userId)

    const { data: message, error } = await admin
      .from('direct_messages')
      .insert({
        conversation_id: convId,
        sender_id: profile.id,
        receiver_id: userId,
        content: content.trim(),
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ message })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

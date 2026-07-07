import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/pvp/[id]/messages — fetch messages for a completed challenge
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    // Confirm caller is a participant
    const { data: challenge } = await admin
      .from('pvp_challenges')
      .select('challenger_id, defender_id, status')
      .eq('id', id)
      .or(`challenger_id.eq.${profile.id},defender_id.eq.${profile.id}`)
      .single()

    if (!challenge || challenge.status !== 'completed') {
      return NextResponse.json({ messages: [] })
    }

    // Verify both players have messaging enabled. requireProfile() already
    // fetched the caller's row, so only the opponent needs a lookup — run it
    // in parallel with the messages query (this route is polled every 4s).
    const otherPlayerId = challenge.challenger_id === profile.id
      ? challenge.defender_id
      : challenge.challenger_id

    const [{ data: other }, { data: messages }] = await Promise.all([
      admin
        .from('profiles')
        .select('allow_pvp_messages, username')
        .eq('id', otherPlayerId)
        .single(),
      admin
        .from('pvp_messages')
        .select('id, sender_id, content, created_at')
        .eq('challenge_id', id)
        .order('created_at', { ascending: true })
        .limit(50),
    ])

    const chatEnabled = !!((profile as any).allow_pvp_messages && other?.allow_pvp_messages)

    if (!chatEnabled) {
      return NextResponse.json({ messages: [], chat_enabled: false, other_username: other?.username })
    }

    return NextResponse.json({
      messages: messages ?? [],
      chat_enabled: true,
      other_username: other?.username,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/pvp/[id]/messages — send a message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { content } = await req.json()

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    }
    if (content.length > 200) {
      return NextResponse.json({ error: 'Message too long (max 200 chars)' }, { status: 400 })
    }

    const { data: challenge } = await admin
      .from('pvp_challenges')
      .select('challenger_id, defender_id, status')
      .eq('id', id)
      .or(`challenger_id.eq.${profile.id},defender_id.eq.${profile.id}`)
      .single()

    if (!challenge || challenge.status !== 'completed') {
      return NextResponse.json({ error: 'Challenge not found or not completed' }, { status: 404 })
    }

    // Both players must have messaging enabled
    const otherPlayerId = challenge.challenger_id === profile.id
      ? challenge.defender_id
      : challenge.challenger_id

    const { data: other } = await admin
      .from('profiles')
      .select('allow_pvp_messages')
      .eq('id', otherPlayerId)
      .single()

    if (!(profile as any).allow_pvp_messages || !other?.allow_pvp_messages) {
      return NextResponse.json({ error: 'Both players must enable messaging' }, { status: 403 })
    }

    const { data: message, error } = await admin
      .from('pvp_messages')
      .insert({ challenge_id: id, sender_id: profile.id, content: content.trim() })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ message })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

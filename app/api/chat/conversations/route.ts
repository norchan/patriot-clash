import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/chat/conversations — every DM conversation the player is part of,
// newest first: the other player's info + the latest message as a preview.
// Powers the /messages inbox page.
export async function GET(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: msgs } = await admin
      .from('direct_messages')
      .select('conversation_id, sender_id, receiver_id, content, created_at, read_at')
      .or(`sender_id.eq.${profile.id},receiver_id.eq.${profile.id}`)
      .order('created_at', { ascending: false })
      .limit(400)

    if (!msgs?.length) return NextResponse.json({ conversations: [] })

    // Blocked players' threads stay hidden in both directions
    const { data: blocks } = await admin
      .from('player_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${profile.id},blocked_id.eq.${profile.id}`)
    const hidden = new Set<string>()
    blocks?.forEach(b => {
      if (b.blocker_id === profile.id) hidden.add(b.blocked_id)
      if (b.blocked_id === profile.id) hidden.add(b.blocker_id)
    })

    // Latest message per conversation (msgs are newest-first) + unread tally
    const latest = new Map<string, typeof msgs[number]>()
    const unread = new Map<string, number>()
    for (const m of msgs) {
      if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, m)
      if (m.receiver_id === profile.id && !m.read_at) {
        unread.set(m.conversation_id, (unread.get(m.conversation_id) ?? 0) + 1)
      }
    }

    const otherIds = [...new Set(
      [...latest.values()]
        .map(m => (m.sender_id === profile.id ? m.receiver_id : m.sender_id))
        .filter(id => id && !hidden.has(id))
    )]
    if (otherIds.length === 0) return NextResponse.json({ conversations: [] })

    const { data: others } = await admin
      .from('profiles')
      .select('id, username, avatar_url, party, show_party')
      .in('id', otherIds)
    const otherMap = Object.fromEntries((others ?? []).map(o => [o.id, o]))

    const conversations = [...latest.values()]
      .map(m => {
        const otherId = m.sender_id === profile.id ? m.receiver_id : m.sender_id
        const other = otherMap[otherId]
        if (!other) return null
        return {
          user_id: otherId,
          username: other.username ?? 'Player',
          avatar_url: other.avatar_url ?? null,
          party: other.show_party === false ? null : other.party,
          last_message: (m.content ?? '📷 Photo').slice(0, 90),
          last_from_me: m.sender_id === profile.id,
          last_at: m.created_at,
          unread: unread.get(m.conversation_id) ?? 0,
        }
      })
      .filter(Boolean)

    return NextResponse.json({ conversations })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

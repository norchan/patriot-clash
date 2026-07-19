import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/chat/inbox?since=<iso> — newest incoming message per sender since
// the given time, with sender info. The map polls this to pop up "X sent you
// a message" — snoozing is handled client-side.
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const sinceParam = req.nextUrl.searchParams.get('since')
    const since = sinceParam && !isNaN(Date.parse(sinceParam))
      ? sinceParam
      : new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const { data: msgs } = await admin
      .from('direct_messages')
      .select('id, sender_id, content, created_at')
      .eq('receiver_id', profile.id)
      .is('read_at', null) // already-opened messages never pop the map bubble
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(30)

    if (!msgs?.length) return NextResponse.json({ messages: [] })

    // Latest message per sender, excluding blocked relationships
    const { data: blocks } = await admin
      .from('player_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${profile.id},blocked_id.eq.${profile.id}`)
    const hidden = new Set<string>()
    blocks?.forEach(b => {
      if (b.blocker_id === profile.id) hidden.add(b.blocked_id)
      if (b.blocked_id === profile.id) hidden.add(b.blocker_id)
    })

    const bySender = new Map<string, typeof msgs[number]>()
    for (const m of msgs) {
      if (hidden.has(m.sender_id)) continue
      if (!bySender.has(m.sender_id)) bySender.set(m.sender_id, m)
    }
    if (bySender.size === 0) return NextResponse.json({ messages: [] })

    const senderIds = [...bySender.keys()]
    const { data: senders } = await admin
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', senderIds)
    const senderMap = Object.fromEntries((senders ?? []).map(s => [s.id, s]))

    return NextResponse.json({
      messages: [...bySender.values()].map(m => ({
        sender_id: m.sender_id,
        sender_username: senderMap[m.sender_id]?.username ?? 'Player',
        sender_avatar: senderMap[m.sender_id]?.avatar_url ?? null,
        preview: (m.content ?? '📷 Photo').slice(0, 80),
        created_at: m.created_at,
      })),
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

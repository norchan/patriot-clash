import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/players/block — block (or unblock) a player
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { blocked_id } = await req.json()

    if (!blocked_id || blocked_id === profile.id) {
      return NextResponse.json({ error: 'Invalid player' }, { status: 400 })
    }

    // Toggle: if already blocked, unblock
    const { data: existing } = await admin
      .from('player_blocks')
      .select('blocked_id')
      .eq('blocker_id', profile.id)
      .eq('blocked_id', blocked_id)
      .maybeSingle()

    if (existing) {
      await admin
        .from('player_blocks')
        .delete()
        .eq('blocker_id', profile.id)
        .eq('blocked_id', blocked_id)
      return NextResponse.json({ blocked: false })
    }

    await admin
      .from('player_blocks')
      .insert({ blocker_id: profile.id, blocked_id })

    // Also cancel any pending chat or pvp requests between them
    await admin
      .from('chat_requests')
      .update({ status: 'declined' })
      .or(
        `and(sender_id.eq.${profile.id},receiver_id.eq.${blocked_id}),` +
        `and(sender_id.eq.${blocked_id},receiver_id.eq.${profile.id})`
      )
      .eq('status', 'pending')

    return NextResponse.json({ blocked: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/players/block — list players I've blocked
export async function GET(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: blocks } = await admin
      .from('player_blocks')
      .select('blocked_id, created_at')
      .eq('blocker_id', profile.id)
      .order('created_at', { ascending: false })

    if (!blocks?.length) return NextResponse.json({ blocked: [] })

    const ids = blocks.map(b => b.blocked_id)
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, username')
      .in('id', ids)

    const nameMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]))

    return NextResponse.json({
      blocked: blocks.map(b => ({
        id: b.blocked_id,
        username: nameMap[b.blocked_id] ?? 'Unknown',
        blocked_at: b.created_at,
      })),
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

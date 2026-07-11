import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Town hall chat room — a public AOL/Yahoo-style room. ANY signed-in player
// can read and post, regardless of party or location.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const since = req.nextUrl.searchParams.get('since')

    // This GET is polled while a player has the room open, so it doubles as
    // the presence heartbeat that powers the "who's here" list.
    await admin.from('gym_chat_presence')
      .upsert({ gym_id: id, profile_id: profile.id, last_seen: new Date().toISOString() })

    let q = admin
      .from('gym_chat')
      .select('id, profile_id, content, created_at')
      .eq('gym_id', id)
      .order('created_at', { ascending: false })
      .limit(80)
    if (since) q = q.gt('created_at', since)

    // Active users = seen in the room within the last 70 seconds
    const cutoff = new Date(Date.now() - 70_000).toISOString()
    const [{ data: rows }, { data: present }] = await Promise.all([
      q,
      admin.from('gym_chat_presence')
        .select('profile_id')
        .eq('gym_id', id)
        .gte('last_seen', cutoff),
    ])
    const msgs = (rows ?? []).reverse()

    const ids = [...new Set([
      ...msgs.map(m => m.profile_id),
      ...(present ?? []).map(p => p.profile_id),
    ])]
    const { data: authors } = ids.length
      ? await admin.from('profiles').select('id, username, avatar_url, party').in('id', ids)
      : { data: [] as any[] }
    const byId = Object.fromEntries((authors ?? []).map(a => [a.id, a]))

    return NextResponse.json({
      messages: msgs.map(m => ({
        id: m.id,
        profile_id: m.profile_id,
        content: m.content,
        created_at: m.created_at,
        username: byId[m.profile_id]?.username ?? 'Player',
        avatar_url: byId[m.profile_id]?.avatar_url ?? null,
        party: byId[m.profile_id]?.party ?? null,
      })),
      users: (present ?? []).map(p => ({
        id: p.profile_id,
        username: byId[p.profile_id]?.username ?? 'Player',
        avatar_url: byId[p.profile_id]?.avatar_url ?? null,
        party: byId[p.profile_id]?.party ?? null,
      })),
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/gyms/[id]/chat error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { content } = await req.json()

    const text = (content ?? '').trim()
    if (!text) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
    if (text.length > 300) return NextResponse.json({ error: 'Message too long (300 max)' }, { status: 400 })

    // Simple flood guard: max ~1 message per 1.5s per player per room
    const { data: recent } = await admin
      .from('gym_chat')
      .select('created_at')
      .eq('gym_id', id)
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 1500) {
      return NextResponse.json({ error: 'Slow down a moment' }, { status: 429 })
    }

    const { data: msg, error } = await admin
      .from('gym_chat')
      .insert({ gym_id: id, profile_id: profile.id, content: text })
      .select('id, profile_id, content, created_at')
      .single()
    if (error) throw error

    return NextResponse.json({
      message: {
        ...msg,
        username: profile.username,
        avatar_url: (profile as any).avatar_url ?? null,
        party: profile.party,
      },
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/chat error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

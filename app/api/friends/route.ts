import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Friends are PRIVATE by design: this API only ever returns the CALLER's own
// relationships. There is deliberately no way to fetch another player's
// friends, or even how many they have.

// GET /api/friends            → { friends, incoming, outgoing }
// GET /api/friends?with=<id>  → { status: 'none'|'friends'|'pending_in'|'pending_out', id? }
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const withId = req.nextUrl.searchParams.get('with')

    if (withId) {
      const { data: row } = await admin
        .from('friendships')
        .select('id, requester_id, status')
        .or(`and(requester_id.eq.${profile.id},addressee_id.eq.${withId}),and(requester_id.eq.${withId},addressee_id.eq.${profile.id})`)
        .maybeSingle()
      if (!row) return NextResponse.json({ status: 'none' })
      if (row.status === 'accepted') return NextResponse.json({ status: 'friends', id: row.id })
      return NextResponse.json({ status: row.requester_id === profile.id ? 'pending_out' : 'pending_in', id: row.id })
    }

    const { data: rows } = await admin
      .from('friendships')
      .select('id, requester_id, addressee_id, status, created_at')
      .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`)
      .order('created_at', { ascending: false })

    const ids = new Set<string>()
    for (const r of rows ?? []) { ids.add(r.requester_id); ids.add(r.addressee_id) }
    ids.delete(profile.id)
    const { data: people } = ids.size
      ? await admin.from('profiles').select('id, username, party, avatar_url').in('id', [...ids])
      : { data: [] }
    const who = new Map((people ?? []).map((p: any) => [p.id, p]))

    const shape = (r: any) => {
      const otherId = r.requester_id === profile.id ? r.addressee_id : r.requester_id
      const o = who.get(otherId)
      return { id: r.id, profile_id: otherId, username: o?.username ?? 'Player', party: o?.party ?? null, avatar_url: o?.avatar_url ?? null, since: r.created_at }
    }
    return NextResponse.json({
      friends: (rows ?? []).filter(r => r.status === 'accepted').map(shape),
      incoming: (rows ?? []).filter(r => r.status === 'pending' && r.addressee_id === profile.id).map(shape),
      outgoing: (rows ?? []).filter(r => r.status === 'pending' && r.requester_id === profile.id).map(shape),
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/friends error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/friends?id=<friendship id> — unfriend, or cancel/decline a pending
export async function DELETE(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await admin.from('friendships').delete()
      .eq('id', id)
      .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

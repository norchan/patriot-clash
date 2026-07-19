import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isBlockedEitherWay } from '@/lib/blocks'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { notify } from '@/lib/notify'

// POST /api/friends/request { profile_id } — send a friend request.
// Anyone can friend anyone (cross-party by design). Bots accept instantly.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`friendreq:${profile.id}`, 10, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()
    const { profile_id } = await req.json()

    if (!profile_id || profile_id === profile.id) {
      return NextResponse.json({ error: 'Invalid player' }, { status: 400 })
    }
    const { data: other } = await admin
      .from('profiles').select('id, username, clerk_user_id').eq('id', profile_id).maybeSingle()
    if (!other) return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    if (await isBlockedEitherWay(admin, profile.id, profile_id)) {
      return NextResponse.json({ error: 'Cannot friend this player' }, { status: 403 })
    }

    // existing relationship in either direction?
    const { data: existing } = await admin
      .from('friendships')
      .select('id, status, requester_id')
      .or(`and(requester_id.eq.${profile.id},addressee_id.eq.${profile_id}),and(requester_id.eq.${profile_id},addressee_id.eq.${profile.id})`)
      .maybeSingle()
    if (existing) {
      if (existing.status === 'accepted') return NextResponse.json({ status: 'friends', id: existing.id })
      if (existing.requester_id === profile.id) return NextResponse.json({ status: 'pending_out', id: existing.id })
      // they already asked US → this request is an acceptance
      await admin.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', existing.id)
      await notify(admin, {
        profileId: profile_id, type: 'social',
        title: `👥 ${profile.username} accepted your friend request!`,
        link: '/friends',
      })
      return NextResponse.json({ status: 'friends', id: existing.id })
    }

    const isBot = (other.clerk_user_id ?? '').startsWith('bot')
    const { data: row, error } = await admin.from('friendships').insert({
      requester_id: profile.id,
      addressee_id: profile_id,
      status: isBot ? 'accepted' : 'pending',
      responded_at: isBot ? new Date().toISOString() : null,
    }).select('id').single()
    if (error) throw error

    if (!isBot) {
      await notify(admin, {
        profileId: profile_id, type: 'social',
        title: `👥 ${profile.username} sent you a friend request`,
        link: '/friends',
        dedupeUnreadLink: true,
      })
    }
    return NextResponse.json({ status: isBot ? 'friends' : 'pending_out', id: row.id })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('friend request error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

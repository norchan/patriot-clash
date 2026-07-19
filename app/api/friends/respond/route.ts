import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { notify } from '@/lib/notify'

// POST /api/friends/respond { id, accept } — only the addressee may respond.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id, accept } = await req.json()
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const { data: row } = await admin
      .from('friendships')
      .select('id, requester_id, addressee_id, status')
      .eq('id', id).maybeSingle()
    if (!row || row.addressee_id !== profile.id || row.status !== 'pending') {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (accept) {
      await admin.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', id)
      await notify(admin, {
        profileId: row.requester_id, type: 'social',
        title: `👥 ${profile.username} accepted your friend request!`,
        link: '/friends',
      })
      return NextResponse.json({ status: 'friends' })
    }
    await admin.from('friendships').delete().eq('id', id) // silent decline — requester isn't told
    return NextResponse.json({ status: 'none' })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

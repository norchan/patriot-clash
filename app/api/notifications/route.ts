import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/notifications — latest notifications + unread count
export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const [{ data: items }, { count: unread }] = await Promise.all([
      admin.from('notifications')
        .select('id, type, title, body, link, read, created_at')
        .eq('profile_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50),
      admin.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profile.id)
        .eq('read', false),
    ])

    return NextResponse.json({ notifications: items ?? [], unread: unread ?? 0 })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/notifications { ids?: string[] } — mark read (all when ids omitted)
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { ids } = await req.json().catch(() => ({}))

    let q = admin.from('notifications').update({ read: true }).eq('profile_id', profile.id)
    if (Array.isArray(ids) && ids.length) q = q.in('id', ids.slice(0, 100))
    await q

    return NextResponse.json({ ok: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

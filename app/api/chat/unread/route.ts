import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/chat/unread → { count } — unopened messages for the badge on the
// bottom-nav Messages tab. A message becomes "read" when its thread is opened.
export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { count } = await admin
      .from('direct_messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', profile.id)
      .is('read_at', null)
    return NextResponse.json({ count: count ?? 0 })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ count: 0 })
  }
}

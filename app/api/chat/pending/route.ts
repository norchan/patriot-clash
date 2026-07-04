import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/chat/pending — incoming chat requests waiting for my response
export async function GET(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: requests } = await admin
      .from('chat_requests')
      .select('id, sender_id, created_at, expires_at')
      .eq('receiver_id', profile.id)
      .eq('status', 'pending')
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)

    if (!requests?.length) {
      return NextResponse.json({ request: null })
    }

    const req = requests[0]
    const { data: sender } = await admin
      .from('profiles')
      .select('username, party, show_party')
      .eq('id', req.sender_id)
      .single()

    return NextResponse.json({
      request: {
        id: req.id,
        sender_id: req.sender_id,
        sender_username: sender?.username ?? 'Player',
        sender_party: sender?.show_party ? sender?.party : null,
        expires_at: req.expires_at,
      },
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ request: null })
  }
}

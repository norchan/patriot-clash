import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/chat/request/[id] — status of a chat request. The sender polls
// this after sending so they can open the chat overlay when it's accepted.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: request } = await admin
      .from('chat_requests')
      .select('id, sender_id, receiver_id, status, expires_at')
      .eq('id', id)
      .or(`sender_id.eq.${profile.id},receiver_id.eq.${profile.id}`)
      .single()

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (request.status === 'pending' && new Date(request.expires_at) < new Date()) {
      return NextResponse.json({ ...request, status: 'expired' })
    }

    return NextResponse.json(request)

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/chat/request/[id]/respond — accept or decline a chat request
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { accept } = await req.json()

    const { data: request } = await admin
      .from('chat_requests')
      .select('*')
      .eq('id', id)
      .eq('receiver_id', profile.id)
      .eq('status', 'pending')
      .gte('expires_at', new Date().toISOString())
      .single()

    if (!request) {
      return NextResponse.json({ error: 'Request not found or expired' }, { status: 404 })
    }

    await admin
      .from('chat_requests')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('id', id)

    return NextResponse.json({ status: accept ? 'accepted' : 'declined', sender_id: request.sender_id })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

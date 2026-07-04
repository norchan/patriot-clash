import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// POST /api/gyms/[id]/message
// Update the holder message displayed on a Town Hall the player controls.
// =============================================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id: gymId } = await params

    const { message } = await req.json()

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const trimmed = message.trim().slice(0, 280)
    if (!trimmed) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    }

    // Verify the player holds this gym
    const { data: gym } = await admin
      .from('gyms')
      .select('id, city_name, holder_id')
      .eq('id', gymId)
      .single()

    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    if (gym.holder_id !== profile.id) {
      return NextResponse.json({ error: 'You do not control this Town Hall' }, { status: 403 })
    }

    await admin
      .from('gyms')
      .update({ holder_message: trimmed })
      .eq('id', gymId)

    return NextResponse.json({ success: true, message: trimmed })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/message error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

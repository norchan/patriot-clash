import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/gyms/[id] — a single town hall with holder info (for Siege Mode)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: gym } = await admin
      .from('gyms')
      .select('id, city_name, state, holder_id, holder_party, defense_points, radius_miles, latitude, longitude, landmark_url')
      .eq('id', id)
      .single()

    if (!gym) {
      return NextResponse.json({ error: 'Town hall not found' }, { status: 404 })
    }

    let holder_username: string | null = null
    if (gym.holder_id) {
      const { data: holder } = await admin
        .from('profiles')
        .select('username')
        .eq('id', gym.holder_id)
        .single()
      holder_username = holder?.username ?? null
    }

    return NextResponse.json({ gym: { ...gym, holder_username } })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

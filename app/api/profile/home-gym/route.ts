import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// The player's ASSIGNED TOWN HALL (home hall). Everyone has one:
//  - joining a clique adopts the clique's hall (handled in the clique routes)
//  - otherwise it's auto-assigned to the closest hall on first location fix
//  - and it's changeable any time in Settings
// GET → current hall. POST {gym_id} → set. POST {lat,lng} → auto-assign
// nearest, but ONLY if none is set (never stomps a manual/clique choice).

export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    if (!(profile as any).home_gym_id) return NextResponse.json({ gym: null })
    const { data: gym } = await admin.from('gyms')
      .select('id, city_name, state, holder_party')
      .eq('id', (profile as any).home_gym_id)
      .maybeSingle()
    return NextResponse.json({ gym })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { gym_id, lat, lng } = await req.json()

    let targetId: string | null = null
    if (gym_id) {
      const { data: gym } = await admin.from('gyms').select('id').eq('id', gym_id).maybeSingle()
      if (!gym) return NextResponse.json({ error: 'Town hall not found' }, { status: 404 })
      targetId = gym.id
    } else if (typeof lat === 'number' && typeof lng === 'number') {
      // auto-assign path: never overwrite an existing assignment
      if ((profile as any).home_gym_id) {
        return NextResponse.json({ ok: true, gym_id: (profile as any).home_gym_id })
      }
      const { data: near } = await admin.rpc('gyms_near', { p_lat: lat, p_lng: lng, p_miles: 100 })
      targetId = near?.[0]?.id ?? null
      if (!targetId) return NextResponse.json({ error: 'No hall within 100 miles' }, { status: 404 })
    } else {
      return NextResponse.json({ error: 'gym_id or lat/lng required' }, { status: 400 })
    }

    const { error } = await admin.from('profiles')
      .update({ home_gym_id: targetId })
      .eq('id', profile.id)
    if (error) throw error
    return NextResponse.json({ ok: true, gym_id: targetId })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/profile/home-gym error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

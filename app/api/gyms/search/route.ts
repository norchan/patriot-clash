import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/gyms/search?q= — find town halls by city name (for click creation)
export async function GET(req: NextRequest) {
  try {
    await requireProfile()
    const admin = createSupabaseAdminClient()

    const q = req.nextUrl.searchParams.get('q')?.trim()
    if (!q || q.length < 2) {
      return NextResponse.json({ gyms: [] })
    }

    const { data: gyms, error } = await admin
      .from('gyms')
      .select('id, city_name, state, holder_party')
      .ilike('city_name', `%${q}%`)
      .order('population', { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json({ gyms })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

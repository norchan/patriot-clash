import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// GET /api/gyms?lat=XX&lng=XX
// Returns ALL Town Halls (sorted by distance from the player). Players can
// view and open any hall — attack range is enforced separately per hall.
// =============================================================================
export async function GET(req: NextRequest) {
  try {
    await requireProfile()

    const { searchParams } = new URL(req.url)
    const lat = parseFloat(searchParams.get('lat') || '0')
    const lng = parseFloat(searchParams.get('lng') || '0')

    if (!lat || !lng) {
      return NextResponse.json(
        { error: 'lat and lng are required' },
        { status: 400 }
      )
    }

    // Validate coordinates are reasonable
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: 'Invalid coordinates' },
        { status: 400 }
      )
    }

    const admin = createSupabaseAdminClient()

    // 25,000 miles > Earth's circumference — returns every hall, with
    // distance_miles still computed for range checks and sorting
    const { data: gyms, error } = await admin
      .rpc('gyms_near', {
        p_lat: lat,
        p_lng: lng,
        p_miles: 25000
      })

    if (error) throw error

    // Enrich with holder username + per-hall battle radius (gyms_near predates
    // the radius_miles column, so it's merged from the gyms table here)
    const gymIds = gyms.map((g: any) => g.id)
    let holderMap: Record<string, { username: string; party: string }> = {}
    let radiusMap: Record<string, number> = {}

    if (gymIds.length > 0) {
      // Dedupe holder ids (mostly ~20 bots) and fetch radii with pagination —
      // .in() with 1,000+ UUIDs exceeds URL limits and fails silently
      const holderIds = [...new Set(gyms.filter((g: any) => g.holder_id).map((g: any) => g.holder_id))]

      const fetchAllRadii = async () => {
        const rows: any[] = []
        for (let from = 0; ; from += 1000) {
          const { data } = await admin
            .from('gyms')
            .select('id, radius_miles')
            .range(from, from + 999)
          if (!data?.length) break
          rows.push(...data)
          if (data.length < 1000) break
        }
        return { data: rows }
      }

      const [{ data: holders }, { data: radii }] = await Promise.all([
        holderIds.length > 0
          ? admin.from('profiles').select('id, username, party').in('id', holderIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchAllRadii(),
      ])

      if (holders) {
        holderMap = holders.reduce((acc: Record<string, { username: string; party: string }>, h: any) => {
          acc[h.id] = { username: h.username, party: h.party }
          return acc
        }, {} as Record<string, { username: string; party: string }>)
      }
      if (radii) {
        radiusMap = radii.reduce((acc: Record<string, number>, r: any) => {
          acc[r.id] = Number(r.radius_miles) || 10
          return acc
        }, {} as Record<string, number>)
      }
    }

    const enrichedGyms = gyms.map((gym: any) => ({
      ...gym,
      holder_username: gym.holder_id ? holderMap[gym.holder_id]?.username : null,
      holder_party: gym.holder_id ? holderMap[gym.holder_id]?.party : null,
      radius_miles: radiusMap[gym.id] ?? 10,
      // Calculate distance in miles for display
      distance_miles: gym.dist_meters ? (gym.dist_meters / 1609.34).toFixed(1) : null,
    }))

    return NextResponse.json({ gyms: enrichedGyms })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/gyms error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

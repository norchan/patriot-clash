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
    let usernameMap: Record<string, string> = {}
    let radiusMap: Record<string, number> = {}

    if (gymIds.length > 0) {
      // Every hall now has a (bot) holder, so holderIds can be 2,000+. A single
      // .in() with that many UUIDs exceeds the URL length limit and fails
      // SILENTLY — which blanks every holder and makes ALL halls look
      // unclaimed. Chunk the username lookup, and take holder_party straight
      // from the RPC (authoritative) instead of a profiles join.
      const holderIds = [...new Set(gyms.filter((g: any) => g.holder_id).map((g: any) => g.holder_id))]
      const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

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
        return rows
      }

      const [radii, ...holderChunks] = await Promise.all([
        fetchAllRadii(),
        ...chunk(holderIds, 300).map(ids => admin.from('profiles').select('id, username').in('id', ids)),
      ])

      holderChunks.forEach(res => (res.data ?? []).forEach((h: any) => { usernameMap[h.id] = h.username }))
      radii.forEach((r: any) => { radiusMap[r.id] = Number(r.radius_miles) || 10 })
    }

    const enrichedGyms = gyms.map((gym: any) => ({
      ...gym,
      holder_username: gym.holder_id ? (usernameMap[gym.holder_id] ?? null) : null,
      // holder_party is returned by gyms_near itself — do NOT derive it from a
      // profiles lookup that silently fails once there are 1,000+ holders
      holder_party: gym.holder_party ?? null,
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

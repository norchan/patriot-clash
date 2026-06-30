import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// GET /api/gyms?lat=XX&lng=XX
// Returns all Town Halls within 100 miles of the player's coordinates.
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

    // Use our PostGIS function to find gyms within 100 miles
    const { data: gyms, error } = await admin
      .rpc('gyms_near', {
        p_lat: lat,
        p_lng: lng,
        p_miles: 100
      })

    if (error) throw error

    // Enrich with holder username
    const gymIds = gyms.map((g: any) => g.id)
    let holderMap: Record<string, string> = {}

    if (gymIds.length > 0) {
      const { data: holders } = await admin
        .from('profiles')
        .select('id, username, party')
        .in('id', gyms.filter((g: any) => g.holder_id).map((g: any) => g.holder_id))

      if (holders) {
        holderMap = holders.reduce((acc: any, h: any) => {
          acc[h.id] = { username: h.username, party: h.party }
          return acc
        }, {})
      }
    }

    const enrichedGyms = gyms.map((gym: any) => ({
      ...gym,
      holder_username: gym.holder_id ? holderMap[gym.holder_id]?.username : null,
      holder_party: gym.holder_id ? holderMap[gym.holder_id]?.party : null,
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

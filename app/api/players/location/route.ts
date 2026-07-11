import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// POST /api/players/location
// Upserts the current player's position into player_locations.
// Called every ~10 seconds from the map page while the player is active.
//
// Required Supabase table (run once in SQL editor):
//   create table player_locations (
//     profile_id uuid primary key references profiles(id) on delete cascade,
//     username   text,
//     party      text,
//     lat        double precision not null,
//     lng        double precision not null,
//     updated_at timestamptz default now()
//   );
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { lat, lng } = await req.json()
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'lat and lng must be numbers' }, { status: 400 })
    }

    // Location fuzz: broadcast a position ~1 mile off in a STABLE direction
    // derived from the profile id — stable so the marker doesn't teleport
    // every 10s and can't be averaged back to the true spot
    let outLat = lat, outLng = lng
    if ((profile as any).location_fuzz) {
      let h = 0
      for (const ch of profile.id) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0
      const angle = (Math.abs(h) / 2147483647) * Math.PI * 2
      const distMiles = 0.8 + (Math.abs(Math.imul(h, 2654435761)) / 2147483647) * 0.4 // 0.8–1.2 mi
      outLat = lat + (distMiles / 69) * Math.sin(angle)
      outLng = lng + (distMiles / (69 * Math.cos(lat * Math.PI / 180))) * Math.cos(angle)
    }

    await admin.from('player_locations').upsert(
      {
        profile_id: profile.id,
        username: profile.username,
        party: profile.party,
        lat: outLat,
        lng: outLng,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' }
    )

    return NextResponse.json({ ok: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/players/location error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

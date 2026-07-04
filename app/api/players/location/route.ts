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

    await admin.from('player_locations').upsert(
      {
        profile_id: profile.id,
        username: profile.username,
        party: profile.party,
        lat,
        lng,
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

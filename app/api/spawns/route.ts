import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { republicanEnemies, democratEnemies } from '@/config/enemies'

// GET /api/spawns?lat=&lng= — the SHARED sprite spawns near the player.
// Server-owned: everyone sees the same enemies in the same places. Halls
// regenerate their drop every 10 minutes (spawns live 15). Two of every
// enemy per hall circle — except each party's two legendaries, which get a
// single spot. Spawns vanish for a player once they catch them, and for
// everyone after 5 players have caught them.

const ROSTER = [...republicanEnemies, ...democratEnemies].map(e => ({ id: e.id, copies: e.tier === 'legendary' ? 1 : 2 }))

export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const lat = parseFloat(req.nextUrl.searchParams.get('lat') ?? '')
    const lng = parseFloat(req.nextUrl.searchParams.get('lng') ?? '')
    if (isNaN(lat) || isNaN(lng)) return NextResponse.json({ error: 'lat/lng required' }, { status: 400 })

    // the halls whose circles could reach the player's 5-mile view
    const { data: nearby } = await admin.rpc('gyms_near', { p_lat: lat, p_lng: lng, p_miles: 7 })
    const gymIds: string[] = (nearby ?? []).slice(0, 3).map((g: any) => g.id)
    if (!gymIds.length) return NextResponse.json({ spawns: [] })

    // regenerate any hall whose drop is stale (10-min cadence, advisory-locked)
    await Promise.all(gymIds.map(id => admin.rpc('ensure_gym_spawns', { p_gym_id: id, p_roster: ROSTER })))

    // ⚠ TEST-ONLY (Michael): full roster within a mile of Riggs Rd, St. Peter.
    // Remove this block + the ensure_test_spawns function to end the test.
    const ST_PETER_GYM = '71f74104-8867-49f4-acb7-598aa3617e00'
    if (gymIds.includes(ST_PETER_GYM)) {
      await admin.rpc('ensure_test_spawns', { p_roster: ROSTER })
    }

    const [{ data: rows }, { data: mine }] = await Promise.all([
      admin.from('enemy_spawns')
        .select('id, gym_id, enemy_id, lat, lng, expires_at, catch_count')
        .in('gym_id', gymIds)
        .gt('expires_at', new Date().toISOString())
        .lt('catch_count', 5),
      admin.from('spawn_catches').select('spawn_id').eq('profile_id', profile.id),
    ])
    const caught = new Set((mine ?? []).map((c: any) => c.spawn_id))

    return NextResponse.json({
      spawns: (rows ?? [])
        .filter(r => !caught.has(r.id))
        .map(r => ({ id: r.id, enemy_id: r.enemy_id, lat: r.lat, lng: r.lng, expires_at: r.expires_at })),
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('spawns error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

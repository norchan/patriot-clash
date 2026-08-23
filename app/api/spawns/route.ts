import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { republicanEnemies, democratEnemies, ENEMY_3D_IDS } from '@/config/enemies'

// GET /api/spawns?lat=&lng= — the SHARED sprite spawns near the player.
// Server-owned: everyone sees the same enemies in the same places. Halls
// regenerate their drop every 10 minutes (spawns live 15). Spawns vanish
// for a player once they catch them, and for everyone after 5 catches.
//
// SCARCITY (Michael 2026-07-26): way fewer sprites per circle —
// - commons: always around, ONE copy each (the usual catch)
// - rares: one copy, ~35% of hall cycles (a treat, not a given)
// - the 3 RAREST per party (ELITES): only ~4 times a day, 15-min windows

// per party: both legendaries + the beefiest rare
const ELITES = new Set(['politician', 'billionaire', 'ice_agent', 'dem_politician', 'senator', 'protestor'])
// 4 daily windows, 15 min each (UTC 2/14/18/22 ≈ 9pm/9am/1pm/5pm ET)
const ELITE_HOURS_UTC = [2, 14, 18, 22]
function eliteWindowNow(): boolean {
  const now = new Date()
  return ELITE_HOURS_UTC.includes(now.getUTCHours()) && now.getUTCMinutes() < 15
}

const RIGGED = new Set<string>(ENEMY_3D_IDS)
function buildRoster() {
  const elite = eliteWindowNow()
  // Copies per drop: 1 → 2 (Michael 2026-08-01 "double") → 3 (Michael
  // 2026-08-04 "a few more sprites per town hall"). Every rule stands — elite
  // windows, the 35% rare cycle, opposite-party hunting, 10-min regeneration,
  // 15-min lifetimes, the 5-catch cap — only the copies-per-drop changed.
  // RIGGED-ONLY: the map must never advertise a character the battle stage
  // can't render — unrigged ones were silently swapped for a random rigged
  // sprite at fight start ("wrong characters show up", Michael 2026-08-04).
  return [...republicanEnemies, ...democratEnemies].flatMap(e => {
    if (!RIGGED.has(e.id)) return []
    if (ELITES.has(e.id)) return elite ? [{ id: e.id, copies: 3, tier: e.tier }] : []
    if (e.tier !== 'common') return Math.random() < 0.35 ? [{ id: e.id, copies: 3, tier: e.tier }] : []
    return [{ id: e.id, copies: 3, tier: e.tier }]
  })
}

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
    const roster = buildRoster()
    await Promise.all(gymIds.map(id => admin.rpc('ensure_gym_spawns', { p_gym_id: id, p_roster: roster })))

    const [{ data: rows }, { data: mine }] = await Promise.all([
      admin.from('enemy_spawns')
        .select('id, gym_id, enemy_id, lat, lng, expires_at, catch_count')
        .in('gym_id', gymIds)
        .gt('expires_at', new Date().toISOString())
        .lt('catch_count', 5),
      admin.from('spawn_catches').select('spawn_id').eq('profile_id', profile.id),
    ])
    const caught = new Set((mine ?? []).map((c: any) => c.spawn_id))

    // You only ever hunt the OTHER party (Michael): democrats see republican
    // sprites, republicans see democrat sprites. The shared drop carries both;
    // each viewer gets their half.
    const huntable = new Set(
      (profile.party === 'democrat' ? republicanEnemies
        : profile.party === 'republican' ? democratEnemies
        : [...republicanEnemies, ...democratEnemies]).map(e => e.id)
    )

    const spawns = (rows ?? [])
      .filter(r => !caught.has(r.id) && huntable.has(r.enemy_id))
      .map(r => ({ id: r.id, enemy_id: r.enemy_id, lat: r.lat, lng: r.lng, expires_at: r.expires_at }))

    // DOORSTEP DROP (Michael 2026-08-22: "put a few sprites near my location").
    // The shared hall drop scatters across a 5-mile circle, so a player can
    // open the map with nothing tappable in sight. If fewer than 3 huntable
    // sprites sit within ~0.6mi of the player, top up commons scattered
    // 100-400m around THEM — normal shared rows, normal 15-min lifetime,
    // normal catch rules, so the world stays server-owned. Self-limiting:
    // the top-ups satisfy this same check on the next fetch until they're
    // caught or expire.
    const NEAR_DEG_LAT = 0.6 / 69 // ~0.6 miles in latitude degrees
    const nearCount = spawns.filter(s =>
      Math.abs(s.lat - lat) < NEAR_DEG_LAT
      && Math.abs(s.lng - lng) < NEAR_DEG_LAT / Math.max(0.2, Math.cos(lat * Math.PI / 180))).length
    if (nearCount < 3) {
      const commons = (profile.party === 'democrat' ? republicanEnemies
        : profile.party === 'republican' ? democratEnemies
        : [...republicanEnemies, ...democratEnemies])
        .filter(e => RIGGED.has(e.id) && e.tier === 'common')
        .sort(() => Math.random() - 0.5)
        .slice(0, 3 - nearCount)
      if (commons.length) {
        const fresh = commons.map(e => ({
          gym_id: gymIds[0],
          enemy_id: e.id,
          lat: lat + (Math.random() - 0.5) * 0.006, // ±~330m N-S
          lng: lng + (Math.random() - 0.5) * 0.008, // ±~330m E-W at mid latitudes
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        }))
        const { data: ins } = await admin.from('enemy_spawns')
          .insert(fresh)
          .select('id, enemy_id, lat, lng, expires_at')
        for (const r of ins ?? []) spawns.push({ id: r.id, enemy_id: r.enemy_id, lat: r.lat, lng: r.lng, expires_at: r.expires_at })
      }
    }

    return NextResponse.json({ spawns })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('spawns error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

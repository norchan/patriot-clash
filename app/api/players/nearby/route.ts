import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Deterministic hash → [0, 1) so bot positions stay stable per area
function seededRand(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return Math.abs(h) / 2147483647
}

export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { searchParams } = new URL(req.url)
    const lat = parseFloat(searchParams.get('lat') ?? '')
    const lng = parseFloat(searchParams.get('lng') ?? '')

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    // ~30 mile bounding box (0.44 deg lat, slightly wider for lng at lower US latitudes)
    const delta = 0.44

    // Blocks and locations are independent — run them in parallel (this is
    // the hottest polled endpoint in the app)
    const [{ data: blocks }, { data: locations, error }] = await Promise.all([
      admin
        .from('player_blocks')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${profile.id},blocked_id.eq.${profile.id}`),
      admin
        .from('player_locations')
        .select('profile_id, username, party, lat, lng, updated_at')
        .neq('profile_id', profile.id)
        .gte('lat', lat - delta)
        .lte('lat', lat + delta)
        .gte('lng', lng - delta)
        .lte('lng', lng + delta)
        .gte('updated_at', cutoff)
        .limit(50),
    ])

    const hiddenIds = new Set<string>()
    blocks?.forEach(b => {
      if (b.blocker_id === profile.id) hiddenIds.add(b.blocked_id)
      if (b.blocked_id === profile.id) hiddenIds.add(b.blocker_id)
    })

    if (error) {
      console.error('player_locations query error:', error)
      return NextResponse.json({ players: [] })
    }

    // Filter out blocked players, then enrich with profile preferences
    const visible = (locations ?? []).filter(p => !hiddenIds.has(p.profile_id))

    const ids = visible.map(p => p.profile_id)
    const { data: profilePrefs } = ids.length > 0
      ? await admin
          .from('profiles')
          .select('id, show_party, allow_messages, avatar_url')
          .in('id', ids)
      : { data: [] as any[] }

    const prefMap = Object.fromEntries((profilePrefs ?? []).map(p => [p.id, p]))

    const players = visible.map(p => {
      const pref = prefMap[p.profile_id]
      return {
        profile_id: p.profile_id,
        username: p.username,
        party: pref?.show_party !== false ? p.party : null,
        lat: p.lat,
        lng: p.lng,
        allow_messages: pref?.allow_messages ?? false,
        avatar_url: pref?.avatar_url ?? null,
      }
    })

    // ── Garrison bots ────────────────────────────────────────────────────
    // Every town hall zone has 4 bots from EACH party stationed inside its
    // circle. Which bots and where is seeded by hall id, so the same crew
    // guards the same hall at stable positions.
    const { data: nearbyHalls } = await admin
      .rpc('gyms_near', { p_lat: lat, p_lng: lng, p_miles: 30 })

    const halls = (nearbyHalls ?? []).slice(0, 6) // nearest 6 zones
    if (halls.length > 0) {
      const { data: allBots } = await admin
        .from('profiles')
        .select('id, username, party, avatar_url')
        .like('clerk_user_id', 'bot\\_%')

      const repBots = (allBots ?? []).filter(b => b.party === 'republican')
      const demBots = (allBots ?? []).filter(b => b.party === 'democrat')
      const placed = new Set<string>()

      const pickForHall = (pool: any[], hallId: string, count: number) =>
        pool
          .map(b => ({ b, r: seededRand(`${b.id}|${hallId}`) }))
          .sort((x, y) => x.r - y.r)
          .filter(({ b }) => !placed.has(b.id) && !hiddenIds.has(b.id))
          .slice(0, count)
          .map(({ b }) => b)

      for (const hall of halls) {
        const crew = [...pickForHall(repBots, hall.id, 12), ...pickForHall(demBots, hall.id, 12)]
        for (const bot of crew) {
          placed.add(bot.id)
          const angle = seededRand(`${bot.id}|${hall.id}|a`) * Math.PI * 2
          // Inside the hall's 5-mile circle: 0.3 to 4.3 miles from center
          const distMiles = 0.3 + seededRand(`${bot.id}|${hall.id}|d`) * 4
          players.push({
            profile_id: bot.id,
            username: bot.username,
            party: bot.party,
            lat: hall.latitude + (distMiles / 69) * Math.sin(angle),
            lng: hall.longitude + (distMiles / (69 * Math.cos(hall.latitude * Math.PI / 180))) * Math.cos(angle),
            allow_messages: false,
            avatar_url: bot.avatar_url ?? null,
          })
        }
      }
    }

    return NextResponse.json({ players })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/players/nearby error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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
    // ~15 mile bounding box — tighter visibility keeps marker counts (and
    // phone render cost) down now that halls are dense
    const delta = 0.22

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
          .select('id, show_party, allow_messages, avatar_url, map_visibility, location_fuzz')
          .in('id', ids)
      : { data: [] as any[] }

    const prefMap = Object.fromEntries((profilePrefs ?? []).map(p => [p.id, p]))

    // Incognito: each player controls who can see them on the map
    const hiddenFromMe = (vis: string | null | undefined) =>
      vis === 'nobody' ||
      (vis === 'hide_from_republicans' && profile.party === 'republican') ||
      (vis === 'hide_from_democrats' && profile.party === 'democrat')

    const players = visible
      .filter(p => !hiddenFromMe(prefMap[p.profile_id]?.map_visibility))
      .map(p => {
      const pref = prefMap[p.profile_id]
      return {
        profile_id: p.profile_id,
        username: p.username,
        party: pref?.show_party !== false ? p.party : null,
        lat: p.lat,
        lng: p.lng,
        allow_messages: pref?.allow_messages ?? false,
        avatar_url: pref?.avatar_url ?? null,
        // tells the popup whether this marker is their real spot
        approx: !!pref?.location_fuzz,
      }
    })

    // ── Garrison bots ────────────────────────────────────────────────────
    // Each bot has ONE home town hall (home_gym_id) and is only shown inside
    // that hall's circle — so a bot you see is always a resident whose clique
    // belongs to that same hall. Positions are seeded so they stay stable.
    const { data: nearbyHalls } = await admin
      .rpc('gyms_near', { p_lat: lat, p_lng: lng, p_miles: 15 })

    // Nearest 3 zones only, to keep marker counts (and phone render cost) sane
    const halls = (nearbyHalls ?? []).slice(0, 3)
    if (halls.length > 0) {
      const hallIds = halls.map((h: any) => h.id)
      const { data: residents } = await admin
        .from('profiles')
        .select('id, username, party, avatar_url, home_gym_id')
        .in('home_gym_id', hallIds)
        .like('clerk_user_id', 'bot%')

      const byHall: Record<string, any[]> = {}
      for (const b of residents ?? []) {
        if (hiddenIds.has(b.id)) continue
        ;(byHall[b.home_gym_id] ??= []).push(b)
      }

      for (const hall of halls) {
        const crew = (byHall[hall.id] ?? []).slice(0, 16)
        crew.forEach((bot, i) => {
          // Two independent hashes → a scattered point; sqrt on the radius
          // spreads bots evenly across the disc instead of a ring.
          const angle = seededRand(`${bot.id}|${hall.id}|ang|${i}`) * Math.PI * 2
          const distMiles = 0.25 + Math.sqrt(seededRand(`${bot.id}|${hall.id}|rad|${i}`)) * 4.2
          players.push({
            profile_id: bot.id,
            username: bot.username,
            party: bot.party,
            lat: hall.latitude + (distMiles / 69) * Math.sin(angle),
            lng: hall.longitude + (distMiles / (69 * Math.cos(hall.latitude * Math.PI / 180))) * Math.cos(angle),
            allow_messages: true,
            avatar_url: bot.avatar_url ?? null,
            approx: true, // garrison bots always read as approximate
          })
        })
      }
    }

    return NextResponse.json({ players })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/players/nearby error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

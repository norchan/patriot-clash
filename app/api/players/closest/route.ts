import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { garrisonPosition } from '@/lib/garrison'

// =============================================================================
// GET /api/players/closest?lat&lng[&party=democrat|republican][&gender=male|female]
// ACTIVE PLAYERS screen feed: always returns the `limit` (50) CLOSEST players
// that MATCH the filter — no mileage cap. The map keeps using /nearby with its
// radius limit; this endpoint is only for the Active Players list, so every
// search ("Rep", "female + democrat", ...) fills a full page of the nearest
// matching people.
// Privacy rules are identical to /nearby: blocks both ways, incognito
// (map_visibility), hidden party respected (party-hidden players are excluded
// from party-filtered searches, included under All with party null).
// =============================================================================

function seededRand(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return Math.abs(h) / 2147483647
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { searchParams } = new URL(req.url)
    const lat = parseFloat(searchParams.get('lat') ?? '')
    const lng = parseFloat(searchParams.get('lng') ?? '')
    const partyF = searchParams.get('party') // democrat | republican | null
    const genderF = searchParams.get('gender') // male | female | null
    const limit = 50

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const [{ data: blocks }, { data: locations }] = await Promise.all([
      admin
        .from('player_blocks')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${profile.id},blocked_id.eq.${profile.id}`),
      // NO bounding box — the whole point is "closest 50, wherever they are"
      admin
        .from('player_locations')
        .select('profile_id, username, party, lat, lng, updated_at')
        .neq('profile_id', profile.id)
        .gte('updated_at', cutoff)
        .limit(500),
    ])

    const hiddenIds = new Set<string>()
    blocks?.forEach(b => {
      if (b.blocker_id === profile.id) hiddenIds.add(b.blocked_id)
      if (b.blocked_id === profile.id) hiddenIds.add(b.blocker_id)
    })

    const humans = (locations ?? []).filter(p => !hiddenIds.has(p.profile_id))
    const ids = humans.map(p => p.profile_id)
    const { data: profilePrefs } = ids.length > 0
      ? await admin
          .from('profiles')
          .select('id, show_party, allow_messages, avatar_url, map_visibility, location_fuzz, gender')
          .in('id', ids)
      : { data: [] as any[] }
    const prefMap = Object.fromEntries((profilePrefs ?? []).map(p => [p.id, p]))

    const hiddenFromMe = (vis: string | null | undefined) =>
      vis === 'nobody' ||
      (vis === 'hide_from_republicans' && profile.party === 'republican') ||
      (vis === 'hide_from_democrats' && profile.party === 'democrat')

    type Row = {
      profile_id: string; username: string; party: string | null; lat: number; lng: number
      allow_messages: boolean; avatar_url: string | null; gender: string | null; approx: boolean; dist: number
    }
    const out: Row[] = []

    for (const p of humans) {
      const pref = prefMap[p.profile_id]
      if (hiddenFromMe(pref?.map_visibility)) continue
      const shownParty = pref?.show_party !== false ? p.party : null
      const gender = pref?.gender ?? null
      // filter matching happens on what the SEARCHER is allowed to see
      if (partyF && shownParty !== partyF) continue
      if (genderF && gender !== genderF) continue
      out.push({
        profile_id: p.profile_id,
        username: p.username,
        party: shownParty,
        lat: p.lat,
        lng: p.lng,
        allow_messages: pref?.allow_messages ?? false,
        avatar_url: pref?.avatar_url ?? null,
        gender,
        approx: !!pref?.location_fuzz,
        dist: milesBetween(lat, lng, p.lat, p.lng),
      })
    }

    // ── Garrison bots, nearest halls outward until the page can fill ────────
    const { data: nearbyHalls } = await admin
      .rpc('gyms_near', { p_lat: lat, p_lng: lng, p_miles: 500 })
    const halls = (nearbyHalls ?? []).slice(0, 40)
    if (halls.length > 0) {
      const hallIds = halls.map((h: any) => h.id)
      let q = admin
        .from('profiles')
        .select('id, username, party, avatar_url, home_gym_id, gender')
        .in('home_gym_id', hallIds)
        .like('clerk_user_id', 'bot%')
      if (partyF) q = q.eq('party', partyF)
      const { data: residents } = await q

      const hallById: Record<string, any> = Object.fromEntries(halls.map((h: any) => [h.id, h]))
      const perHall: Record<string, number> = {}
      for (const bot of residents ?? []) {
        if (hiddenIds.has(bot.id)) continue
        const hall = hallById[bot.home_gym_id]
        if (!hall) continue
        // same 16-per-hall cap as the map, so lists and map agree on who exists
        if ((perHall[bot.home_gym_id] = (perHall[bot.home_gym_id] ?? 0) + 1) > 16) continue
        const gender = bot.gender ?? (seededRand(`${bot.id}|gender`) < 0.5 ? 'male' : 'female')
        if (genderF && gender !== genderF) continue
        const pos = garrisonPosition(bot.id, hall.id, hall.latitude, hall.longitude)
        out.push({
          profile_id: bot.id,
          username: bot.username,
          party: bot.party,
          lat: pos.lat,
          lng: pos.lng,
          allow_messages: true,
          avatar_url: bot.avatar_url ?? null,
          gender,
          approx: true,
          dist: milesBetween(lat, lng, pos.lat, pos.lng),
        })
      }
    }

    out.sort((a, b) => a.dist - b.dist)
    const players = out.slice(0, limit).map(({ dist: _d, ...p }) => p)
    return NextResponse.json({ players })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/players/closest error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

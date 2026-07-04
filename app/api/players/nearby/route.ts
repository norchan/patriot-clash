import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

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

    // Fetch block relationships in both directions
    const { data: blocks } = await admin
      .from('player_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${profile.id},blocked_id.eq.${profile.id}`)

    const hiddenIds = new Set<string>()
    blocks?.forEach(b => {
      if (b.blocker_id === profile.id) hiddenIds.add(b.blocked_id)
      if (b.blocked_id === profile.id) hiddenIds.add(b.blocker_id)
    })

    const { data: locations, error } = await admin
      .from('player_locations')
      .select('profile_id, username, party, lat, lng, updated_at')
      .neq('profile_id', profile.id)
      .gte('lat', lat - delta)
      .lte('lat', lat + delta)
      .gte('lng', lng - delta)
      .lte('lng', lng + delta)
      .gte('updated_at', cutoff)
      .limit(50)

    if (error) {
      console.error('player_locations query error:', error)
      return NextResponse.json({ players: [] })
    }

    // Filter out blocked players, then enrich with profile preferences
    const visible = (locations ?? []).filter(p => !hiddenIds.has(p.profile_id))
    if (!visible.length) return NextResponse.json({ players: [] })

    const ids = visible.map(p => p.profile_id)
    const { data: profilePrefs } = await admin
      .from('profiles')
      .select('id, show_party, allow_messages')
      .in('id', ids)

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
      }
    })

    return NextResponse.json({ players })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/players/nearby error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

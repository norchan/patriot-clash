import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// PUBLIC (no auth): the anonymized world snapshot for the guest preview map.
// Halls come back with position/party/name; players come back as party-
// colored DOTS ONLY — no ids, no usernames, no avatars. Nothing here is
// interactable without an account.

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient()
    const lat = parseFloat(req.nextUrl.searchParams.get('lat') ?? '')
    const lng = parseFloat(req.nextUrl.searchParams.get('lng') ?? '')
    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
    }

    const [{ data: gyms }, { data: locations }] = await Promise.all([
      admin.rpc('gyms_near', { p_lat: lat, p_lng: lng, p_miles: 120 }),
      admin
        .from('player_locations')
        .select('party, lat, lng, updated_at')
        .gte('lat', lat - 0.6).lte('lat', lat + 0.6)
        .gte('lng', lng - 0.6).lte('lng', lng + 0.6)
        .gte('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(60),
    ])

    return NextResponse.json({
      halls: (gyms ?? []).slice(0, 120).map((g: any) => ({
        city_name: g.city_name,
        state: g.state,
        latitude: g.latitude,
        longitude: g.longitude,
        holder_party: g.holder_party,
        radius_miles: g.radius_miles ?? 5,
      })),
      // anonymized: party + jittered position only. Garrison bots patrol
      // hall zones (seeded like the authed map), so the preview looks alive
      players: [
        ...(locations ?? []).map((p: any) => ({
          party: p.party === 'democrat' ? 'democrat' : 'republican',
          lat: p.lat + (Math.random() - 0.5) * 0.004,
          lng: p.lng + (Math.random() - 0.5) * 0.004,
        })),
        ...(gyms ?? []).slice(0, 5).flatMap((g: any) => {
          const rand = (seed: string) => {
            let h = 0
            for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
            return Math.abs(h) / 2147483647
          }
          return Array.from({ length: 10 }, (_, i) => {
            const angle = rand(`${g.id}|a${i}`) * Math.PI * 2
            const dist = 0.3 + Math.sqrt(rand(`${g.id}|r${i}`)) * 4
            return {
              party: i % 2 === 0 ? 'republican' : 'democrat',
              lat: Number(g.latitude) + (dist / 69) * Math.sin(angle),
              lng: Number(g.longitude) + (dist / (69 * Math.cos(Number(g.latitude) * Math.PI / 180))) * Math.cos(angle),
            }
          })
        }),
      ],
    }, { headers: { 'Cache-Control': 'public, max-age=30' } })

  } catch (err) {
    console.error('GET /api/public/world error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse, clientIp } from '@/lib/ratelimit'

// PUBLIC (no auth): a single town hall's guest-viewable snapshot — who holds
// it, how well defended, and its recent feed. Read-only; challenging/posting
// takes an account. Same safe-subset discipline as /api/public/base.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (rateLimited(`pubhall:${clientIp(req)}`, 40, 60_000)) return rateLimitResponse()
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const admin = createSupabaseAdminClient()
    const { data: g } = await admin.from('gyms')
      .select('id, city_name, county, state, holder_id, holder_party, holder_message, defense_points, held_since, total_captures, radius_miles, latitude, longitude')
      .eq('id', id).maybeSingle()
    if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // holder name (join, so it's not stored denormalized in the safe payload)
    let holderName: string | null = null
    if (g.holder_id) {
      const { data: h } = await admin.from('profiles').select('username').eq('id', g.holder_id).maybeSingle()
      holderName = h?.username ?? null
    }

    // recent hall feed — the town square, read-only for guests
    const { data: posts } = await admin.from('hall_posts')
      .select('id, content, image_url, image_url2, score, comment_count, created_at, party, profiles!hall_posts_profile_id_fkey(username, avatar_url)')
      .eq('gym_id', id).eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      hall: {
        id: g.id,
        city_name: g.city_name, county: g.county, state: g.state,
        holder_party: g.holder_party, holder_username: holderName,
        holder_message: g.holder_message,
        defense_points: g.defense_points ?? 0,
        held_since: g.held_since,
        total_captures: g.total_captures ?? 0,
        radius_miles: g.radius_miles ?? 5,
        latitude: g.latitude, longitude: g.longitude,
      },
      posts: (posts ?? []).map((p: any) => ({
        id: p.id, content: p.content, image_url: p.image_url, image_url2: p.image_url2 ?? null,
        score: p.score, comment_count: p.comment_count, created_at: p.created_at, party: p.party,
        username: p.profiles?.username ?? 'Player', avatar_url: p.profiles?.avatar_url ?? null,
      })),
    })
  } catch (err) {
    console.error('GET /api/public/hall error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

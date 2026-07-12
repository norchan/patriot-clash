import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/players/[id]/profile — public view of any player's profile:
// username, avatar, party (respecting show_party), stats, click, recent posts.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const viewer = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: player } = await admin
      .from('profiles')
      .select('id, username, party, show_party, avatar_url, clique_id, clerk_user_id, total_battles_won, total_battles_lost, total_gyms_captured, total_captures, created_at')
      .eq('id', id)
      .single()

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    // Clique membership is public and reveals party by design. Every bot now
    // has ONE home hall and a clique there, so its stored clique matches the
    // hall it's shown in — no contextual lookup needed.
    let clique = null
    if (player.clique_id) {
      const { data: c } = await admin
        .from('cliques')
        .select('id, name, party, gym_id')
        .eq('id', player.clique_id)
        .single()
      clique = c
    }

    // Location for a "View on map" link — only if this player isn't incognito
    // to the viewer (same rules as the map). Bots return their nearest-hall
    // spot isn't tracked, so only real players expose a location here.
    let location: { lat: number; lng: number; approx: boolean } | null = null
    {
      const { data: prefs } = await admin
        .from('profiles').select('map_visibility, location_fuzz').eq('id', id).maybeSingle()
      const vis = prefs?.map_visibility as string | null
      const hidden = vis === 'nobody'
        || (vis === 'hide_from_republicans' && viewer.party === 'republican')
        || (vis === 'hide_from_democrats' && viewer.party === 'democrat')
      if (!hidden) {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
        const { data: loc } = await admin
          .from('player_locations').select('lat, lng, updated_at').eq('profile_id', id)
          .gte('updated_at', cutoff).maybeSingle()
        if (loc) location = { lat: loc.lat, lng: loc.lng, approx: !!prefs?.location_fuzz }
      }
    }

    const [{ data: posts }, { count: hallsHeld }, { data: photos }] = await Promise.all([
      admin
        .from('profile_posts')
        .select('id, content, score, created_at')
        .eq('profile_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      // Halls held is computed live — the counter column lags for bots that
      // were garrisoned by seeding rather than by capturing
      admin.from('gyms').select('id', { count: 'exact', head: true }).eq('holder_id', id),
      admin.from('profile_photos').select('id, url').eq('profile_id', id)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    ])

    return NextResponse.json({
      profile: {
        id: player.id,
        username: player.username,
        party: player.show_party !== false ? player.party : null,
        avatar_url: player.avatar_url,
        total_battles_won: player.total_battles_won,
        total_battles_lost: player.total_battles_lost,
        total_gyms_captured: Math.max(player.total_gyms_captured ?? 0, hallsHeld ?? 0),
        halls_held: hallsHeld ?? 0,
        total_captures: player.total_captures,
      },
      clique,
      location,
      posts: await (async () => {
        const list = posts ?? []
        if (!list.length) return list
        const { data: myVotes } = await admin
          .from('profile_post_votes')
          .select('post_id, vote')
          .eq('profile_id', viewer.id)
          .in('post_id', list.map(p => p.id))
        const voteById = Object.fromEntries((myVotes ?? []).map(v => [v.post_id, v.vote]))
        return list.map(p => ({ ...p, my_vote: voteById[p.id] ?? 0 }))
      })(),
      // Album: the avatar first, then any extra photos
      photos: [
        ...(player.avatar_url ? [{ id: 'avatar', url: player.avatar_url }] : []),
        ...(photos ?? []),
      ],
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

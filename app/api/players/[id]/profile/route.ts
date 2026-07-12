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

    const isBot = typeof player.clerk_user_id === 'string' && player.clerk_user_id.startsWith('bot')
    const lat = parseFloat(_req.nextUrl.searchParams.get('lat') ?? '')
    const lng = parseFloat(_req.nextUrl.searchParams.get('lng') ?? '')

    // Clique membership is public and reveals party by design. Bots are
    // "garrison" bots that appear at MANY town halls, so their clique is shown
    // contextually: the clique tied to the town hall they're being viewed at
    // (created on demand if that hall doesn't have one yet). Real players use
    // their actual clique.
    let clique = null
    if (isBot && !isNaN(lat) && !isNaN(lng) && player.party) {
      const { data: near } = await admin.rpc('gyms_near', { p_lat: lat, p_lng: lng, p_miles: 40 })
      const hall = (near ?? []).sort((a: any, b: any) => parseFloat(a.distance_miles) - parseFloat(b.distance_miles))[0]
      if (hall) {
        const { data: existing } = await admin
          .from('cliques').select('id, name, party, gym_id')
          .eq('gym_id', hall.id).eq('party', player.party).limit(1).maybeSingle()
        if (existing) clique = existing
        else {
          const label = player.party === 'democrat' ? 'Blue' : 'Red'
          const { data: created } = await admin.from('cliques').insert({
            name: `${label} — ${hall.city_name}`, gym_id: hall.id, party: player.party,
            creator_id: player.id, join_policy: 'open',
          }).select('id, name, party, gym_id').single()
          clique = created
        }
      }
    }
    if (!clique && player.clique_id) {
      const { data: c } = await admin
        .from('cliques')
        .select('id, name, party, gym_id')
        .eq('id', player.clique_id)
        .single()
      clique = c
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

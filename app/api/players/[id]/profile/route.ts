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
    await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: player } = await admin
      .from('profiles')
      .select('id, username, party, show_party, avatar_url, clique_id, total_battles_won, total_battles_lost, total_gyms_captured, total_captures, created_at')
      .eq('id', id)
      .single()

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    // Click membership is public and reveals party by design — joining a
    // click is an affiliation statement even if show_party is off
    let clique = null
    if (player.clique_id) {
      const { data: c } = await admin
        .from('cliques')
        .select('id, name, party, gym_id')
        .eq('id', player.clique_id)
        .single()
      clique = c
    }

    const { data: posts } = await admin
      .from('profile_posts')
      .select('id, content, created_at')
      .eq('profile_id', id)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      profile: {
        id: player.id,
        username: player.username,
        party: player.show_party !== false ? player.party : null,
        avatar_url: player.avatar_url,
        total_battles_won: player.total_battles_won,
        total_battles_lost: player.total_battles_lost,
        total_gyms_captured: player.total_gyms_captured,
        total_captures: player.total_captures,
      },
      clique,
      posts: posts ?? [],
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/posts/vote { kind: 'clique' | 'profile', post_id, vote: 1|-1|0 }
// One vote per player per post, 0 clears — same semantics as hall posts.
// Clique posts can only be voted on by members of that clique.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { kind, post_id, vote } = await req.json()

    if (![1, -1, 0].includes(vote) || !post_id) {
      return NextResponse.json({ error: 'Invalid vote' }, { status: 400 })
    }
    if (kind !== 'clique' && kind !== 'profile') {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    const postsTable = kind === 'clique' ? 'clique_posts' : 'profile_posts'
    const votesTable = kind === 'clique' ? 'clique_post_votes' : 'profile_post_votes'

    const { data: post } = await admin
      .from(postsTable)
      .select(kind === 'clique' ? 'id, score, clique_id' : 'id, score')
      .eq('id', post_id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (kind === 'clique' && (post as any).clique_id !== (profile as any).clique_id) {
      return NextResponse.json({ error: 'Members only' }, { status: 403 })
    }

    const { data: existing } = await admin
      .from(votesTable)
      .select('vote')
      .eq('post_id', post_id)
      .eq('profile_id', profile.id)
      .maybeSingle()

    const old = existing?.vote ?? 0
    const delta = vote - old
    if (delta !== 0) {
      if (vote === 0) {
        await admin.from(votesTable).delete().eq('post_id', post_id).eq('profile_id', profile.id)
      } else {
        await admin.from(votesTable).upsert(
          { post_id, profile_id: profile.id, vote },
          { onConflict: 'post_id,profile_id' }
        )
      }
      await admin.from(postsTable).update({ score: (post as any).score + delta }).eq('id', post_id)
    }

    return NextResponse.json({ score: (post as any).score + delta, my_vote: vote })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/posts/vote error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

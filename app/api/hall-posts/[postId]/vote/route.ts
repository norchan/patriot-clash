import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/hall-posts/[postId]/vote { vote: 1 | -1 | 0 } — 0 clears.
// Returns the new cached score and the caller's vote.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { postId } = await params
    const { vote } = await req.json()
    if (![1, -1, 0].includes(vote)) {
      return NextResponse.json({ error: 'Invalid vote' }, { status: 400 })
    }

    const [{ data: post }, { data: existing }] = await Promise.all([
      admin.from('hall_posts').select('id, score').eq('id', postId).maybeSingle(),
      admin.from('hall_post_votes').select('vote').eq('post_id', postId).eq('profile_id', profile.id).maybeSingle(),
    ])
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    const old = existing?.vote ?? 0
    const delta = vote - old
    if (delta !== 0) {
      if (vote === 0) {
        await admin.from('hall_post_votes').delete().eq('post_id', postId).eq('profile_id', profile.id)
      } else {
        await admin.from('hall_post_votes').upsert(
          { post_id: postId, profile_id: profile.id, vote },
          { onConflict: 'post_id,profile_id' }
        )
      }
      await admin.from('hall_posts').update({ score: post.score + delta }).eq('id', postId)
    }

    return NextResponse.json({ score: post.score + delta, my_vote: vote })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/hall-posts/[postId]/vote error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

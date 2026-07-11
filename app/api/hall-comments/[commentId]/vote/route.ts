import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/hall-comments/[commentId]/vote { vote: 1 | -1 | 0 } — 0 clears.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { commentId } = await params
    const { vote } = await req.json()
    if (![1, -1, 0].includes(vote)) {
      return NextResponse.json({ error: 'Invalid vote' }, { status: 400 })
    }

    const [{ data: comment }, { data: existing }] = await Promise.all([
      admin.from('hall_comments').select('id, score').eq('id', commentId).maybeSingle(),
      admin.from('hall_comment_votes').select('vote').eq('comment_id', commentId).eq('profile_id', profile.id).maybeSingle(),
    ])
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    const old = existing?.vote ?? 0
    const delta = vote - old
    if (delta !== 0) {
      if (vote === 0) {
        await admin.from('hall_comment_votes').delete().eq('comment_id', commentId).eq('profile_id', profile.id)
      } else {
        await admin.from('hall_comment_votes').upsert(
          { comment_id: commentId, profile_id: profile.id, vote },
          { onConflict: 'comment_id,profile_id' }
        )
      }
      await admin.from('hall_comments').update({ score: comment.score + delta }).eq('id', commentId)
    }

    return NextResponse.json({ score: comment.score + delta, my_vote: vote })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/hall-comments/[commentId]/vote error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

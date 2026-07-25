import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/posts/[id]/comments/[commentId]/vote — vote on comment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const viewer = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id: postId, commentId } = await params
    const { vote } = await req.json()

    if (![1, -1, 0].includes(vote)) {
      return NextResponse.json({ error: 'Vote must be 1, -1, or 0' }, { status: 400 })
    }

    // Get the comment and post
    const { data: comment } = await admin
      .from('profile_comments')
      .select('post_id')
      .eq('id', commentId)
      .single()

    if (!comment || comment.post_id !== postId) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    // Get post to check access
    const { data: post } = await admin
      .from('profile_posts')
      .select('profile_id')
      .eq('id', postId)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Check access (owner or friend)
    const isOwner = viewer.id === post.profile_id
    if (!isOwner) {
      const { data: friendship } = await admin
        .from('friendships')
        .select('id')
        .eq('status', 'accepted')
        .or(`and(requester_id.eq.${viewer.id},addressee_id.eq.${post.profile_id}),and(requester_id.eq.${post.profile_id},addressee_id.eq.${viewer.id})`)
        .maybeSingle()

      if (!friendship) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // Upsert the vote
    if (vote === 0) {
      // Delete vote
      await admin
        .from('profile_comment_votes')
        .delete()
        .eq('comment_id', commentId)
        .eq('profile_id', viewer.id)
    } else {
      // Upsert vote
      await admin
        .from('profile_comment_votes')
        .upsert({
          comment_id: commentId,
          profile_id: viewer.id,
          vote,
        })
    }

    // Calculate new score
    const { data: votes } = await admin
      .from('profile_comment_votes')
      .select('vote')
      .eq('comment_id', commentId)

    const newScore = (votes || []).reduce((sum, v) => sum + v.vote, 0)

    // Update comment score
    await admin
      .from('profile_comments')
      .update({ score: newScore })
      .eq('id', commentId)

    return NextResponse.json({ score: newScore, vote })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('Error voting on comment:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

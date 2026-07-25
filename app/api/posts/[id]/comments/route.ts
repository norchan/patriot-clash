import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/posts/[id]/comments — add a comment (friends + owner only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const viewer = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id: postId } = await params
    const { content, parentCommentId } = await req.json()

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })
    }

    // Get the post to check ownership
    const { data: post } = await admin
      .from('profile_posts')
      .select('profile_id')
      .eq('id', postId)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Check if viewer is the owner or a friend
    const isOwner = viewer.id === post.profile_id
    if (!isOwner) {
      // Check friendship
      const { data: friendship } = await admin
        .from('friendships')
        .select('id')
        .eq('status', 'accepted')
        .or(`and(requester_id.eq.${viewer.id},addressee_id.eq.${post.profile_id}),and(requester_id.eq.${post.profile_id},addressee_id.eq.${viewer.id})`)
        .maybeSingle()

      if (!friendship) {
        return NextResponse.json({ error: 'Only friends can comment' }, { status: 403 })
      }
    }

    // Create the comment
    const { data: comment, error } = await admin
      .from('profile_comments')
      .insert({
        post_id: postId,
        profile_id: viewer.id,
        parent_comment_id: parentCommentId || null,
        content: content.trim(),
      })
      .select('id, post_id, profile_id, parent_comment_id, content, score, created_at, profiles!profile_comments_profile_id_fkey(id, username, avatar_url)')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ comment })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('Error creating comment:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

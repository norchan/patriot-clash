import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/posts/[postId] — get post with all comments (threaded)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const admin = createSupabaseAdminClient()
    const { postId } = await params

    // Get the post
    const { data: post } = await admin
      .from('profile_posts')
      .select('id, profile_id, content, score, media_url, media_type, created_at, profiles!profile_posts_profile_id_fkey(id, username, avatar_url, party)')
      .eq('id', postId)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Get all comments for this post (with votes)
    const { data: comments } = await admin
      .from('profile_comments')
      .select('id, post_id, profile_id, parent_comment_id, content, score, created_at, profiles!profile_comments_profile_id_fkey(id, username, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: false })

    // Get votes for this post (if user is signed in, handled on frontend)
    return NextResponse.json({
      post: {
        ...post,
        profile: post.profiles,
      },
      comments: comments || [],
    })
  } catch (err: any) {
    console.error('Error fetching post:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/posts/[id] — get post with all comments (threaded)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = createSupabaseAdminClient()
    const { id } = await params

    // Get the post
    const { data: post } = await admin
      .from('profile_posts')
      .select('id, profile_id, content, score, media_url, media_type, created_at, profiles!profile_posts_profile_id_fkey(id, username, avatar_url, party)')
      .eq('id', id)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Get all comments for this post (with votes)
    const { data: comments } = await admin
      .from('profile_comments')
      .select('id, post_id, profile_id, parent_comment_id, content, score, created_at, profiles!profile_comments_profile_id_fkey(id, username, avatar_url)')
      .eq('post_id', id)
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

// DELETE /api/posts/[id] — delete your own post
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { error } = await admin
      .from('profile_posts')
      .delete()
      .eq('id', id)
      .eq('profile_id', profile.id)

    if (error) throw error
    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

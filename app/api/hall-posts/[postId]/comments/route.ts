import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateText } from '@/lib/moderation'

// POST /api/hall-posts/[postId]/comments { content, parent_id? } — reply to
// the post, or to another comment (parent_id), Reddit style.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { postId } = await params
    const { content, parent_id } = await req.json()
    const text = (content ?? '').trim()
    if (!text) return NextResponse.json({ error: 'Say something' }, { status: 400 })
    if (text.length > 800) return NextResponse.json({ error: 'Comment too long (800 max)' }, { status: 400 })

    const verdict = await moderateText(text)
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason ?? 'Comment rejected' }, { status: 400 })
    }

    const { data: post } = await admin.from('hall_posts').select('id, comment_count').eq('id', postId).maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    if (parent_id) {
      const { data: parent } = await admin.from('hall_comments').select('id').eq('id', parent_id).eq('post_id', postId).maybeSingle()
      if (!parent) return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 })
    }

    const { data: comment, error } = await admin
      .from('hall_comments')
      .insert({ post_id: postId, parent_id: parent_id ?? null, profile_id: profile.id, content: text })
      .select('id, parent_id, profile_id, content, score, created_at')
      .single()
    if (error) throw error

    await admin.from('hall_posts').update({ comment_count: post.comment_count + 1 }).eq('id', postId)

    return NextResponse.json({
      comment: {
        ...comment,
        username: profile.username,
        avatar_url: (profile as any).avatar_url ?? null,
        party: profile.party,
        my_vote: 0,
        is_mine: true,
      },
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/hall-posts/[postId]/comments error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

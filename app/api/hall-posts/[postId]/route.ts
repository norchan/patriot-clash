import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/hall-posts/[postId] — full post + every comment (flat; the client
// nests by parent_id and sorts top-level by score)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { postId } = await params

    const [{ data: post }, { data: comments }] = await Promise.all([
      admin.from('hall_posts')
        .select('id, gym_id, profile_id, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at, hidden')
        .eq('id', postId).maybeSingle(),
      admin.from('hall_comments')
        .select('id, parent_id, profile_id, content, score, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .limit(300),
    ])
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    // Community-hidden posts stay visible only to their author
    if (post.hidden && post.profile_id !== profile.id) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const authorIds = [...new Set([post.profile_id, ...(comments ?? []).map(c => c.profile_id)])]
    const commentIds = (comments ?? []).map(c => c.id)
    const [{ data: authors }, { data: myPostVote }, { data: myCommentVotes }] = await Promise.all([
      admin.from('profiles').select('id, username, avatar_url, party').in('id', authorIds),
      admin.from('hall_post_votes').select('vote').eq('post_id', postId).eq('profile_id', profile.id).maybeSingle(),
      commentIds.length
        ? admin.from('hall_comment_votes').select('comment_id, vote').eq('profile_id', profile.id).in('comment_id', commentIds)
        : Promise.resolve({ data: [] as any[] }),
    ])
    const byId = Object.fromEntries((authors ?? []).map(a => [a.id, a]))
    const voteById = Object.fromEntries((myCommentVotes ?? []).map((v: any) => [v.comment_id, v.vote]))

    const decorate = (pid: string) => ({
      username: byId[pid]?.username ?? 'Unknown',
      avatar_url: byId[pid]?.avatar_url ?? null,
      party: byId[pid]?.party ?? null,
      is_mine: pid === profile.id,
    })

    return NextResponse.json({
      post: { ...post, ...decorate(post.profile_id), my_vote: myPostVote?.vote ?? 0 },
      comments: (comments ?? []).map(c => ({ ...c, ...decorate(c.profile_id), my_vote: voteById[c.id] ?? 0 })),
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/hall-posts/[postId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/hall-posts/[postId] — author only
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { postId } = await params

    const { data: post } = await admin.from('hall_posts').select('id, profile_id').eq('id', postId).maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (post.profile_id !== profile.id) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

    await admin.from('hall_posts').delete().eq('id', postId)
    return NextResponse.json({ deleted: postId })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

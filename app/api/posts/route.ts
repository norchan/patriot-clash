import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateText } from '@/lib/moderation'

// GET /api/posts?profile_id=... — a profile's post feed (defaults to your own)
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const profileId = req.nextUrl.searchParams.get('profile_id') || profile.id

    const { data: posts, error } = await admin
      .from('profile_posts')
      .select('id, profile_id, content, score, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) throw error

    const ids = (posts ?? []).map(p => p.id)
    const { data: myVotes } = ids.length
      ? await admin.from('profile_post_votes').select('post_id, vote').eq('profile_id', profile.id).in('post_id', ids)
      : { data: [] as any[] }
    const voteById = Object.fromEntries((myVotes ?? []).map((v: any) => [v.post_id, v.vote]))

    return NextResponse.json({ posts: (posts ?? []).map(p => ({ ...p, my_vote: voteById[p.id] ?? 0 })) })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/posts — publish a post to your own profile
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { content } = await req.json()
    if (!content?.trim() || content.length > 500) {
      return NextResponse.json({ error: 'Post must be 1-500 characters' }, { status: 400 })
    }

    const verdict = await moderateText(content.trim())
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason ?? 'Post rejected' }, { status: 400 })
    }

    const { data: post, error } = await admin
      .from('profile_posts')
      .insert({ profile_id: profile.id, content: content.trim() })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ post })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

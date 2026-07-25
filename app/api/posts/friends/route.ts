import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/posts/friends — the profile page's Friend Feed toggle (Michael):
// the latest posts from everyone you're friends with, newest first.

export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: rows } = await admin.from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`)
    const friendIds = [...new Set((rows ?? []).flatMap(r => [r.requester_id, r.addressee_id]))]
      .filter(id => id !== profile.id)
    if (!friendIds.length) return NextResponse.json({ posts: [] })

    const { data: posts } = await admin.from('profile_posts')
      .select('id, profile_id, content, media_type, media_url, score, created_at, impressions, profiles!profile_posts_profile_id_fkey(username, avatar_url, party)')
      .in('profile_id', friendIds)
      .order('created_at', { ascending: false })
      .limit(40)

    return NextResponse.json({
      posts: (posts ?? []).map((p: any) => ({
        id: p.id,
        profile_id: p.profile_id,
        content: p.content,
        media_type: p.media_type,
        media_url: p.media_url,
        score: p.score,
        created_at: p.created_at,
        impressions: p.impressions ?? 0,
        username: p.profiles?.username ?? 'Friend',
        avatar_url: p.profiles?.avatar_url ?? null,
        party: p.profiles?.party ?? null,
      })),
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/posts/friends error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

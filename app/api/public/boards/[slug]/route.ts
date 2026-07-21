import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolvePBoard, fetchBoardPosts } from '@/lib/boards'

// Public psub feed JSON — powers the homepage boards deck (no auth; the
// boards are the town's public squares). Cached a minute at the edge.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const sort = req.nextUrl.searchParams.get('sort') === 'new' ? 'new' as const : 'top' as const
    const admin = createSupabaseAdminClient()
    const rb = await resolvePBoard(admin, slug)
    if (!rb) return NextResponse.json({ error: 'No such board' }, { status: 404 })

    const posts = await fetchBoardPosts(admin, rb, sort, 40)
    return NextResponse.json(
      {
        board: rb.label,
        posts: posts.map((p: any) => ({
          id: p.id,
          content: p.content,
          image_url: p.image_url,
          link_title: p.link_title,
          link_domain: p.link_domain,
          score: p.score,
          comment_count: p.comment_count,
          created_at: p.created_at,
          party: p.party,
          username: p.profiles?.username ?? 'Player',
          city: p.gyms?.city_name ?? null,
          state: p.gyms?.state ?? null,
        })),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } },
    )
  } catch (err) {
    console.error('GET /api/public/boards/[slug] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

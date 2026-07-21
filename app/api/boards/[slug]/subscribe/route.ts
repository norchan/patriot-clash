import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/boards/[slug]/subscribe — toggle. Subscribed psubs show as tabs
// on the homepage boards deck and pin into Featured on /p.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { slug } = await params

    const { data: board } = await admin.from('boards')
      .select('id, slug')
      .eq('slug', slug.toLowerCase())
      .maybeSingle()
    if (!board) return NextResponse.json({ error: 'No such board' }, { status: 404 })

    const { data: existing } = await admin.from('board_subscriptions')
      .select('board_id')
      .eq('profile_id', profile.id)
      .eq('board_id', board.id)
      .maybeSingle()

    if (existing) {
      await admin.from('board_subscriptions')
        .delete()
        .eq('profile_id', profile.id)
        .eq('board_id', board.id)
      return NextResponse.json({ subscribed: false })
    }

    const { count } = await admin.from('board_subscriptions')
      .select('board_id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
    if ((count ?? 0) >= 50) {
      return NextResponse.json({ error: 'Subscription limit reached (50)' }, { status: 429 })
    }

    await admin.from('board_subscriptions')
      .insert({ profile_id: profile.id, board_id: board.id })
    return NextResponse.json({ subscribed: true })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/boards/[slug]/subscribe error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

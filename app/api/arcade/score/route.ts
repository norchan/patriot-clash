import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/arcade/score { game, score, session_id } — submit a run's score
// for the public leaderboards. Must reference a live server session for the
// game (same anti-fake anchor as rewards); only improves your personal best.
const GAMES = new Set(['landslide', 'tetkris', 'chess', 'spotit'])
const MAX_SCORE: Record<string, number> = {
  landslide: 500_000, tetkris: 1_000_000, chess: 1_000, spotit: 120,
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const game = String(body.game)
    if (!GAMES.has(game)) return NextResponse.json({ error: 'Unknown game' }, { status: 400 })
    const score = Math.max(0, Math.min(MAX_SCORE[game], Math.floor(Number(body.score) || 0)))
    if (!score) return NextResponse.json({ ok: true })
    if (typeof body.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.session_id)) {
      return NextResponse.json({ error: 'No session' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles').select('id').eq('clerk_user_id', userId).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const { data: session } = await admin
      .from('arcade_sessions').select('id, game')
      .eq('id', body.session_id).eq('profile_id', profile.id).maybeSingle()
    if (!session || session.game !== game) {
      return NextResponse.json({ error: 'No session' }, { status: 400 })
    }

    await admin.rpc('record_arcade_best', { p_profile_id: profile.id, p_game: game, p_score: score })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('arcade score error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { FREE_GAMES, ARCADE_DAILY_CAP, type FreeGame } from '@/lib/arcade'

// POST /api/arcade/session { game } — start a server-owned play session.
// Free-game rewards must reference one; this is the anti-farm anchor.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const { game } = await req.json()
    if (!FREE_GAMES.includes(game as FreeGame)) {
      return NextResponse.json({ error: 'Unknown game' }, { status: 400 })
    }
    const admin = createSupabaseAdminClient()

    const { data: session, error } = await admin
      .from('arcade_sessions')
      .insert({ profile_id: profile.id, game })
      .select('id')
      .single()
    if (error) throw error

    // let the client show how much daily headroom is left
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
    const { data: todays } = await admin
      .from('arcade_sessions')
      .select('awarded_fp')
      .eq('profile_id', profile.id)
      .gte('created_at', dayStart.toISOString())
    const earnedToday = (todays ?? []).reduce((s, r) => s + (r.awarded_fp ?? 0), 0)

    return NextResponse.json({
      session_id: session.id,
      daily_cap: ARCADE_DAILY_CAP,
      earned_today: earnedToday,
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('arcade session error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

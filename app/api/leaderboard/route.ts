import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const VALID_TYPES = ['fp', 'wins', 'gyms', 'captures'] as const
type LeaderboardType = typeof VALID_TYPES[number]

const ORDER_COL: Record<LeaderboardType, string> = {
  fp:       'fp_balance',
  wins:     'total_battles_won',
  gyms:     'total_gyms_captured',
  captures: 'total_captures',
}

export async function GET(req: NextRequest) {
  try {
    const type = (req.nextUrl.searchParams.get('type') || 'fp') as LeaderboardType
    const col = ORDER_COL[type] ?? 'fp_balance'

    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('profiles')
      .select('id, username, party, fp_balance, total_battles_won, total_gyms_captured, total_captures')
      .order(col, { ascending: false })
      .limit(25)

    if (error) throw error

    return NextResponse.json({ players: data ?? [] })
  } catch (err: any) {
    console.error('GET /api/leaderboard error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

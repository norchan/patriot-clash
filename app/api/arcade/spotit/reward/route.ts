import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { clampArcadeAward } from '@/lib/arcade'

// POST /api/arcade/spotit/reward  { event: 'find'|'scene', found?, session_id }
// Spot the Difference. 25 FP per difference found; scene completion bonus 100.
// Session rate + shared daily cap bound scripted claims.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    let award = 0
    if (body.event === 'find') award = 25
    else if (body.event === 'scene') award = 100
    else return NextResponse.json({ error: 'Invalid event' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles').select('id').eq('clerk_user_id', userId).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const { allowed, reason } = await clampArcadeAward(profile.id, 'spotit', body.session_id, award)
    if (allowed === 0) {
      return NextResponse.json({ awarded: 0, capped: reason === 'DAILY_CAP', reason })
    }

    const { data: newBalance, error } = await admin.rpc('grant_fp', {
      p_profile_id: profile.id, p_amount: allowed,
      p_type: 'arcade', p_reference_type: 'spotit',
      p_description: `Spot the Difference ${body.event}`,
    })
    if (error) throw error

    return NextResponse.json({ awarded: allowed, balance: newBalance })
  } catch (err) {
    console.error('spotit reward error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

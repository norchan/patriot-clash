import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { clampArcadeAward } from '@/lib/arcade'

// POST /api/arcade/solitaire/reward  { event: 'cards'|'win', count?, session_id }
// Solitaire. 5 FP per foundation card (batched client-side), 150 for a win.
// Session rate + shared daily cap bound scripted claims.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    let award = 0
    if (body.event === 'cards') {
      const n = Math.min(52, Math.max(1, Math.floor(body.count ?? 1)))
      award = 5 * n
    } else if (body.event === 'win') award = 150
    else return NextResponse.json({ error: 'Invalid event' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles').select('id').eq('clerk_user_id', userId).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const { allowed, reason } = await clampArcadeAward(profile.id, 'solitaire', body.session_id, award)
    if (allowed === 0) {
      return NextResponse.json({ awarded: 0, capped: reason === 'DAILY_CAP', reason })
    }

    const { data: newBalance, error } = await admin.rpc('grant_fp', {
      p_profile_id: profile.id, p_amount: allowed,
      p_type: 'arcade', p_reference_type: 'solitaire',
      p_description: `Solitaire ${body.event}`,
    })
    if (error) throw error

    return NextResponse.json({ awarded: allowed, balance: newBalance })
  } catch (err) {
    console.error('solitaire reward error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { clampArcadeAward } from '@/lib/arcade'

// POST /api/arcade/chess/reward  { depth: 1|2|3, tries, session_id }
// Chess puzzle solved. Base FP by mate depth, reduced by wrong tries; the
// session rate + shared daily cap bound anything a scripted client could claim.
const BASE: Record<number, number> = { 1: 40, 2: 80, 3: 150 }

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const depth = Number(body.depth)
    const tries = Math.max(0, Math.min(3, Math.floor(Number(body.tries) || 0)))
    if (!BASE[depth]) return NextResponse.json({ error: 'Invalid depth' }, { status: 400 })

    const award = Math.floor(BASE[depth] * (tries === 0 ? 1 : tries === 1 ? 0.6 : 0.3))
    if (award === 0) return NextResponse.json({ awarded: 0 })

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles').select('id').eq('clerk_user_id', userId).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const { allowed, reason } = await clampArcadeAward(profile.id, 'chess', body.session_id, award)
    if (allowed === 0) {
      return NextResponse.json({ awarded: 0, capped: reason === 'DAILY_CAP', reason })
    }

    const { data: newBalance, error } = await admin.rpc('grant_fp', {
      p_profile_id: profile.id, p_amount: allowed,
      p_type: 'arcade', p_reference_type: 'chess',
      p_description: `Chess puzzle solved (mate in ${depth})`,
    })
    if (error) throw error

    return NextResponse.json({ awarded: allowed, balance: newBalance })
  } catch (err) {
    console.error('chess reward error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { BET_OPTIONS, getMachine, pickSymbol, evaluateSpin } from '@/config/slots'

// POST /api/arcade/slots/spin  { machine, bet }
// Server-authoritative: the reels and payout are decided here so FP can't be
// spoofed from the client. Deducts the bet, rolls three reels, credits any
// win, returns the reels + payout + new balance.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { machine, bet } = await req.json()
    const m = getMachine(String(machine))
    if (!m) return NextResponse.json({ error: 'Invalid machine' }, { status: 400 })
    if (!BET_OPTIONS.includes(bet)) {
      return NextResponse.json({ error: 'Invalid bet' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('id, fp_balance')
      .eq('clerk_user_id', userId)
      .single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    if (profile.fp_balance < bet) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP', balance: profile.fp_balance }, { status: 400 })
    }

    const reels = [pickSymbol(), pickSymbol(), pickSymbol()]
    const { mult, payout } = evaluateSpin(reels, bet)

    const newBalance = profile.fp_balance - bet + payout
    const { error } = await admin
      .from('profiles')
      .update({ fp_balance: newBalance })
      .eq('id', profile.id)
    if (error) throw error

    return NextResponse.json({
      reels,
      mult,
      payout,
      bet,
      jackpot: reels[0] === 0 && reels[1] === 0 && reels[2] === 0,
      balance: newBalance,
    })
  } catch (err) {
    console.error('slots spin error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

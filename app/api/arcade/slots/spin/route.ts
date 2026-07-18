import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import {
  BET_OPTIONS, getMachine, spinGrid, evaluateGrid,
  FS_MULTIPLIER, FS_RETRIGGER, FS_MAX,
} from '@/config/slots'

// POST /api/arcade/slots/spin  { machine, bet }
// Server-authoritative: the whole outcome — the base grid plus every free
// spin the bonus awards — is decided here so FP can't be spoofed. The client
// just plays the sequence back. Deducts the bet once, credits the total.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { machine, bet } = await req.json()
    const m = getMachine(String(machine))
    if (!m) return NextResponse.json({ error: 'Invalid machine' }, { status: 400 })
    if (!BET_OPTIONS.includes(bet)) return NextResponse.json({ error: 'Invalid bet' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles').select('id, fp_balance').eq('clerk_user_id', userId).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    if (profile.fp_balance < bet) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP', balance: profile.fp_balance }, { status: 400 })
    }

    // Base spin
    const baseGrid = spinGrid()
    const base = evaluateGrid(baseGrid, bet, 1)
    let totalPayout = base.payout

    // Free spins (all resolved up front)
    const freeGrids: { grid: number[][]; eval: ReturnType<typeof evaluateGrid> }[] = []
    if (base.freeSpins > 0) {
      let remaining = base.freeSpins
      let awarded = base.freeSpins
      while (remaining > 0) {
        const g = spinGrid()
        const ev = evaluateGrid(g, bet, FS_MULTIPLIER)
        totalPayout += ev.payout
        freeGrids.push({ grid: g, eval: ev })
        if (ev.freeSpins > 0 && awarded < FS_MAX) {
          const add = Math.min(FS_RETRIGGER, FS_MAX - awarded)
          remaining += add; awarded += add
        }
        remaining--
      }
    }

    // ONE transaction: bet deduction + win credit together (slots_settle).
    // Fails atomically — a mid-settle error can't eat the bet, and an
    // insufficient balance (raced below the bet) rejects cleanly.
    const { data: settled, error: settleErr } = await admin.rpc('slots_settle', {
      p_profile_id: profile.id, p_bet: bet, p_payout: totalPayout,
    })
    if (settleErr) {
      if (settleErr.message?.includes('INSUFFICIENT_FP')) {
        return NextResponse.json({ error: 'INSUFFICIENT_FP', balance: profile.fp_balance }, { status: 400 })
      }
      throw settleErr
    }
    const newBalance = settled as number

    return NextResponse.json({
      bet,
      base: { grid: baseGrid, wins: base.wins, payout: base.payout, scatterCount: base.scatterCount, scatterPositions: base.scatterPositions, freeSpins: base.freeSpins },
      freeSpins: freeGrids.map(f => ({ grid: f.grid, wins: f.eval.wins, payout: f.eval.payout, scatterCount: f.eval.scatterCount })),
      freeSpinCount: freeGrids.length,
      totalPayout,
      balance: newBalance,
    })
  } catch (err) {
    console.error('slots spin error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

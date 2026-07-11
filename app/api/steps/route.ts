import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// POST /api/steps
// Called by the mobile app to sync step count from device pedometer.
// Awards FP: 100 FP per 50 steps (no daily cap — see award_step_fp in
// Supabase), plus a 500 FP daily bonus on first sync of the day.
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const body = await req.json()
    const { steps, date } = body

    // Validate
    if (!steps || typeof steps !== 'number' || steps < 0) {
      return NextResponse.json({ error: 'Invalid step count' }, { status: 400 })
    }

    // Use today's date if not provided
    const recordDate = date || new Date().toISOString().split('T')[0]

    // ── Anti-cheat clamps ─────────────────────────────────────────────────
    // Steps are client-reported (device motion) so they can be spoofed; the
    // server bounds the damage: 30k/day hard cap (~world-class step count)
    // and max +8,000 steps per sync (the client syncs every 15 min; 8k
    // covers a missed sync at running pace with headroom).
    const DAILY_CAP = 30000
    const PER_SYNC_CAP = 8000

    const { data: existingRec } = await admin
      .from('step_records')
      .select('step_count')
      .eq('profile_id', profile.id)
      .eq('record_date', recordDate)
      .maybeSingle()

    const prevSteps = existingRec?.step_count ?? 0
    const cappedSteps = Math.max(
      prevSteps,
      Math.min(steps, DAILY_CAP, prevSteps + PER_SYNC_CAP)
    )

    // Award FP using our database function
    const { data: fpAwarded, error } = await admin
      .rpc('award_step_fp', {
        p_profile_id: profile.id,
        p_record_date: recordDate,
        p_steps: cappedSteps,
      })

    if (error) throw error

    // Get updated balance
    const { data: updatedProfile } = await admin
      .from('profiles')
      .select('fp_balance, total_steps')
      .eq('id', profile.id)
      .single()

    // Check for daily bonus (first sync of the day)
    let dailyBonusAwarded = 0
    if (profile.last_daily_bonus !== recordDate) {
      dailyBonusAwarded = 1000 // daily bonus, auto-granted on first sync
      await admin.rpc('grant_fp', {
        p_profile_id: profile.id,
        p_amount: dailyBonusAwarded,
        p_type: 'daily_bonus',
        p_description: `Daily login bonus: ${recordDate}`
      })

      await admin
        .from('profiles')
        .update({ last_daily_bonus: recordDate })
        .eq('id', profile.id)
    }

    return NextResponse.json({
      success: true,
      steps_recorded: cappedSteps,
      fp_awarded: fpAwarded + dailyBonusAwarded,
      step_fp: fpAwarded,
      daily_bonus: dailyBonusAwarded,
      new_balance: (updatedProfile?.fp_balance || 0) + dailyBonusAwarded,
      total_steps: updatedProfile?.total_steps || 0,
      message: fpAwarded > 0
        ? `⚡ +${fpAwarded + dailyBonusAwarded} FP earned from walking!`
        : 'Steps recorded. Keep walking for more FP!',
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/steps error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// =============================================================================
// GET /api/steps
// Returns step history for the current player
// =============================================================================
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: steps, error } = await admin
      .from('step_records')
      .select('*')
      .eq('profile_id', profile.id)
      .order('record_date', { ascending: false })
      .limit(30) // Last 30 days

    if (error) throw error

    return NextResponse.json({
      steps,
      total_steps: profile.total_steps,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const MIN_DONATION = 10
const MAX_DONATION = 10000

// =============================================================================
// POST /api/gyms/[id]/donate
// Donate FP to a Town Hall held by YOUR party: 1 FP = 1 defense point.
// Any same-party player can reinforce, not just the holder.
// =============================================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id: gymId } = await params

    const body = await req.json()
    const amount = Math.floor(Number(body.amount))

    if (!Number.isFinite(amount) || amount < MIN_DONATION || amount > MAX_DONATION) {
      return NextResponse.json(
        { error: `Donation must be between ${MIN_DONATION} and ${MAX_DONATION} FP` },
        { status: 400 }
      )
    }

    const { data: gym } = await admin
      .from('gyms')
      .select('id, city_name, holder_party, defense_points')
      .eq('id', gymId)
      .single()

    if (!gym) {
      return NextResponse.json({ error: 'Town Hall not found' }, { status: 404 })
    }

    // Donating to an enemy or unclaimed hall would reinforce the opposition
    if (!gym.holder_party || gym.holder_party !== profile.party) {
      return NextResponse.json(
        { error: 'You can only donate to Town Halls held by your party' },
        { status: 403 }
      )
    }

    if (profile.fp_balance < amount) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP' }, { status: 400 })
    }

    // NOTE: p_type must be a value the spend_fp RPC already allows — custom
    // types like 'gym_donation' are rejected by the DB function. The
    // description carries the donation semantics in the ledger.
    const { error: spendErr } = await admin.rpc('spend_fp', {
      p_profile_id: profile.id,
      p_amount: amount,
      p_type: 'gym_attack',
      p_reference_type: 'gym_defense',
      p_description: `Donated ${amount} FP to ${gym.city_name} Town Hall`,
    })

    if (spendErr) {
      console.error('gym donation spend_fp failed:', spendErr)
      return NextResponse.json({ error: 'FP transfer failed' }, { status: 500 })
    }

    const newDefense = (gym.defense_points || 0) + amount
    const { error: updateErr } = await admin
      .from('gyms')
      .update({ defense_points: newDefense })
      .eq('id', gymId)

    if (updateErr) {
      // Refund — the FP was taken but the defense never landed
      console.error('gym donation update failed, refunding:', updateErr)
      await admin.rpc('grant_fp', {
        p_profile_id: profile.id,
        p_amount: amount,
        p_type: 'battle_reward',
        p_reference_type: 'gym_defense',
        p_description: `Refund: donation to ${gym.city_name} failed`,
      })
      return NextResponse.json({ error: 'Donation failed — FP refunded' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      defense_points: newDefense,
      message: `🏛️ +${amount.toLocaleString()} defense for ${gym.city_name}! (now ${newDefense.toLocaleString()})`,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/donate error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

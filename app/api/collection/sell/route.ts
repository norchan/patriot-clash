import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Sell prices sit below the EXPECTED capture cost (cost / success rate:
// common 15/0.75=20, rare 30/0.40=75, legendary 75/0.15=500), so the
// capture→sell loop can never mint FP.
const SELL_PRICES: Record<string, number> = { common: 10, rare: 40, legendary: 250 }

// POST /api/collection/sell { captured_id } — sell one captured character
// back to the game for FP
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { captured_id } = await req.json()

    if (!captured_id) return NextResponse.json({ error: 'captured_id required' }, { status: 400 })

    // Delete-with-ownership-filter is the atomic claim: only one request
    // can remove the row, so a double-tap can't sell twice
    const { data: sold } = await admin
      .from('captured_characters')
      .delete()
      .eq('id', captured_id)
      .eq('profile_id', profile.id)
      .select('*')
      .maybeSingle()

    if (!sold) {
      return NextResponse.json({ error: 'Character not found in your collection' }, { status: 404 })
    }

    const price = SELL_PRICES[sold.enemy_tier] ?? 10
    const { error: grantErr } = await admin.rpc('grant_fp', {
      p_profile_id: profile.id, p_amount: price,
      p_type: 'battle_reward', p_reference_type: 'collection_sale',
      p_description: `Sold ${sold.enemy_name}`,
    })
    if (grantErr) {
      // Payment failed — put the character back so nothing is lost
      console.error('collection sell grant_fp failed, restoring character:', grantErr)
      await admin.from('captured_characters').insert(sold)
      return NextResponse.json({ error: 'Sale failed — character returned to your collection' }, { status: 500 })
    }

    return NextResponse.json({ sold: sold.enemy_name, fp_earned: price })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/collection/sell error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

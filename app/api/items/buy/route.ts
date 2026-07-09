import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { ITEM_MAP, type ItemType } from '@/config/items'

// POST /api/items/buy { item } — spend FP for one boost item
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { item } = await req.json()

    const def = ITEM_MAP[item as ItemType]
    if (!def) return NextResponse.json({ error: 'Unknown item' }, { status: 400 })
    if (profile.fp_balance < def.price) {
      return NextResponse.json({ error: `Need ${def.price} FP for a ${def.name}` }, { status: 400 })
    }

    const { error: spendErr } = await admin.rpc('spend_fp', {
      p_profile_id: profile.id, p_amount: def.price,
      p_type: 'defense_purchase', p_reference_type: 'item',
      p_description: `Bought ${def.name}`,
    })
    if (spendErr) {
      console.error('item buy spend_fp failed:', spendErr)
      return NextResponse.json({ error: 'FP payment failed' }, { status: 500 })
    }

    const { data: row } = await admin
      .from('player_items')
      .select('quantity')
      .eq('profile_id', profile.id)
      .eq('item_type', def.id)
      .maybeSingle()
    const { error: upErr } = await admin.from('player_items').upsert({
      profile_id: profile.id,
      item_type: def.id,
      quantity: (row?.quantity ?? 0) + 1,
    })
    if (upErr) {
      // refund — the item never landed
      await admin.rpc('grant_fp', {
        p_profile_id: profile.id, p_amount: def.price,
        p_type: 'battle_reward', p_reference_type: 'item',
        p_description: `Refund: ${def.name} purchase failed`,
      })
      return NextResponse.json({ error: 'Purchase failed — FP refunded' }, { status: 500 })
    }

    return NextResponse.json({ item: def.id, quantity: (row?.quantity ?? 0) + 1 })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/items/buy error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

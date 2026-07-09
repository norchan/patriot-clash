import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { ITEMS, DAILY_FREE_ITEM } from '@/config/items'

// GET /api/items — the player's boost inventory. Claims the daily free
// firecracker on first call of each UTC day.
export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    // Daily freebie: atomic on last_free_item_at so refresh-spamming can't
    // stack free items
    const today = new Date().toISOString().slice(0, 10)
    let freeGranted = false
    const { data: claimed } = await admin
      .from('profiles')
      .update({ last_free_item_at: today })
      .eq('id', profile.id)
      .or(`last_free_item_at.is.null,last_free_item_at.lt.${today}`)
      .select('id')
      .maybeSingle()

    if (claimed) {
      const { data: row } = await admin
        .from('player_items')
        .select('quantity')
        .eq('profile_id', profile.id)
        .eq('item_type', DAILY_FREE_ITEM)
        .maybeSingle()
      await admin.from('player_items').upsert({
        profile_id: profile.id,
        item_type: DAILY_FREE_ITEM,
        quantity: (row?.quantity ?? 0) + 1,
      })
      freeGranted = true
    }

    const { data: rows } = await admin
      .from('player_items')
      .select('item_type, quantity')
      .eq('profile_id', profile.id)

    const items: Record<string, number> = {}
    for (const i of ITEMS) items[i.id] = 0
    for (const r of rows ?? []) items[r.item_type] = r.quantity

    return NextResponse.json({ items, free_granted: freeGranted })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/items error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

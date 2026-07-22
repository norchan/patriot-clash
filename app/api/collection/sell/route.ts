import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Sell prices sit below the EXPECTED capture cost (cost / success rate:
// common 15/0.75=20, rare 30/0.40=75, legendary 75/0.15=500), so the
// capture→sell loop can never mint FP.
const SELL_PRICES: Record<string, number> = { common: 10, rare: 40, legendary: 250 }

// POST /api/collection/sell { enemy_id } — sell one SURPLUS copy of a
// character back to the game for FP. The FIRST copy ever caught is a keeper:
// it can never be sold (Michael's rule) — only duplicates go.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { enemy_id, captured_id } = await req.json()

    if (!enemy_id && !captured_id) {
      return NextResponse.json({ error: 'enemy_id required' }, { status: 400 })
    }

    // All copies of this character, oldest first — index 0 is the keeper
    let q = admin.from('captured_characters')
      .select('id, enemy_id, enemy_name, enemy_tier')
      .eq('profile_id', profile.id)
      .order('captured_at', { ascending: true })
    q = enemy_id ? q.eq('enemy_id', enemy_id) : q.eq('id', captured_id)
    const { data: copies } = await q
    const all = copies ?? []
    // legacy captured_id calls: re-fetch the full set for that enemy
    let set = all
    if (!enemy_id && all.length === 1) {
      const { data: full } = await admin.from('captured_characters')
        .select('id, enemy_id, enemy_name, enemy_tier')
        .eq('profile_id', profile.id)
        .eq('enemy_id', all[0].enemy_id)
        .order('captured_at', { ascending: true })
      set = full ?? all
    }

    if (set.length === 0) {
      return NextResponse.json({ error: 'Character not found in your collection' }, { status: 404 })
    }
    if (set.length < 2) {
      return NextResponse.json({ error: 'Your first catch is a keeper — only extra copies can be sold' }, { status: 400 })
    }

    // Sell the NEWEST surplus copy; delete-by-id is the atomic claim, so a
    // double-tap can't sell the same row twice (second request 404s)
    const target = set[set.length - 1]
    const { data: sold } = await admin
      .from('captured_characters')
      .delete()
      .eq('id', target.id)
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

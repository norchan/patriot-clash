import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { printShopReady, printShopNextInMs, PRINT_SHOP_CAP, PRINT_SHOP_RATE_MS } from '@/lib/farm'

// Campaign HQ — the Print Shop (siege Phase B4).
// GET  → production status (ready count, cap, countdown)
// POST → claim: atomic SQL (claim_print_shop) adds firecrackers to the bag

export async function GET() {
  try {
    const profile = await requireProfile()
    const elapsed = Date.now() - new Date(profile.print_shop_claimed_at ?? Date.now()).getTime()
    return NextResponse.json({
      ready: printShopReady(elapsed),
      cap: PRINT_SHOP_CAP,
      rate_hours: PRINT_SHOP_RATE_MS / 3600000,
      next_in_secs: Math.ceil(printShopNextInMs(elapsed) / 1000),
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { data: claimed, error } = await admin.rpc('claim_print_shop', { p_profile_id: profile.id })
    if (error) {
      console.error('claim_print_shop failed:', error)
      return NextResponse.json({ error: 'Claim failed' }, { status: 500 })
    }
    return NextResponse.json({ claimed: claimed ?? 0 })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

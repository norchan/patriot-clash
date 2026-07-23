import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// GET /api/pvp/pending
// Returns the most recent incoming LIVE challenge for the current player.
// Challenges arm instantly now (no accept step), so this is the freshly-armed
// fight the defender should be pulled into. The map polls this every 5s and
// routes them straight to the ring.
// =============================================================================
export async function GET(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: challenge } = await admin
      .from('pvp_challenges')
      .select('id, challenger_id, challenger_username, challenger_party, fp_stake, expires_at')
      .eq('defender_id', profile.id)
      .eq('status', 'accepted')
      .gte('accepted_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({ challenge: challenge ?? null })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ challenge: null })
  }
}

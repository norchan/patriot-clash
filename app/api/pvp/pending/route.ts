import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// GET /api/pvp/pending
// Returns the most recent incoming pending challenge for the current player.
// The map page polls this every 5 seconds to show the challenge notification.
// =============================================================================
export async function GET(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { data: challenge } = await admin
      .from('pvp_challenges')
      .select('id, challenger_id, challenger_username, challenger_party, fp_stake, expires_at')
      .eq('defender_id', profile.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({ challenge: challenge ?? null })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ challenge: null })
  }
}

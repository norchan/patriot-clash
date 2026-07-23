import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/profile/onboard { party, gender } — the new-player onboarding.
// Party is required (democrat|republican) and locks their side; gender is
// male|female|none ("no response"). Sets `onboarded` so the homepage stops
// bouncing them here.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { party, gender } = await req.json()

    if (!['democrat', 'republican'].includes(party)) {
      return NextResponse.json({ error: 'Pick a party' }, { status: 400 })
    }
    const g = ['male', 'female', 'none'].includes(gender) ? gender : 'none'

    const { error } = await admin
      .from('profiles')
      .update({ party, gender: g, onboarded: true })
      .eq('id', profile.id)
    if (error) throw error

    return NextResponse.json({ success: true, party, gender: g })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('onboard error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

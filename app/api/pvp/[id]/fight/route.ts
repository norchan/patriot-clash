import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { settleInteractiveFight } from '@/lib/pvp'

// POST /api/pvp/[id]/fight — the challenger submits the outcome of their
// live fight. Only valid on an 'accepted' (armed) challenge, only by the
// challenger, settled exactly once; the submission is sanity-checked hard
// before any FP moves.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const body = await req.json()

    const { data: challenge } = await admin
      .from('pvp_challenges')
      .select('id, challenger_id, defender_id, fp_stake, accepted_at, status')
      .eq('id', id)
      .eq('challenger_id', profile.id)
      .single()

    if (!challenge) {
      return NextResponse.json({ error: 'Fight not found' }, { status: 404 })
    }
    if (challenge.status !== 'accepted') {
      return NextResponse.json({ error: 'Fight is not active' }, { status: 409 })
    }

    const result = await settleInteractiveFight(admin, challenge, body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.payload)

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/pvp/[id]/fight error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

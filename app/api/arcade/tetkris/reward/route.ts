import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/arcade/tetkris/reward  { event: 'lines'|'level', lines?, level }
// The client reports game EVENTS (lines cleared, level reached); the server
// decides the FP so it can't be spoofed, and caps every grant. Free to play —
// no bet is deducted; Tet-Kris only pays out.
const LINE_FP = [0, 30, 80, 150, 300] // FP by simultaneous lines (0..4)
const MAX_PER_REQUEST = 8000

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const level = Math.max(0, Math.min(60, Math.floor(Number(body.level) || 0)))

    let award = 0
    if (body.event === 'lines') {
      const n = Math.max(0, Math.min(4, Math.floor(Number(body.lines) || 0)))
      // higher levels pay more each row ("more FP each round passed")
      award = Math.floor(LINE_FP[n] * (1 + level * 0.15))
    } else if (body.event === 'level') {
      // passing a level pays a scaling bonus
      award = 300 + level * 120
    } else {
      return NextResponse.json({ error: 'Invalid event' }, { status: 400 })
    }
    award = Math.max(0, Math.min(MAX_PER_REQUEST, award))
    if (award === 0) return NextResponse.json({ awarded: 0 })

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles').select('id').eq('clerk_user_id', userId).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Atomic credit (records a ledger row); never read-modify-write the balance.
    const { data: newBalance, error } = await admin.rpc('grant_fp', {
      p_profile_id: profile.id, p_amount: award,
      p_type: 'arcade', p_reference_type: 'tetkris',
      p_description: `Tet-Kris ${body.event}`,
    })
    if (error) throw error

    return NextResponse.json({ awarded: award, balance: newBalance })
  } catch (err) {
    console.error('tetkris reward error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

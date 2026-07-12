import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/arcade/landslide/reward  { event: 'clear'|'level', count?, level }
// The client reports game events; the server decides (and caps) the FP so it
// can't be spoofed. Free to play — Landslide only pays out.
const MAX_PER_REQUEST = 8000

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const level = Math.max(0, Math.min(200, Math.floor(Number(body.level) || 0)))

    let award = 0
    if (body.event === 'clear') {
      const count = Math.max(0, Math.min(200, Math.floor(Number(body.count) || 0)))
      award = Math.floor(count * 3 * (1 + level * 0.1))
    } else if (body.event === 'level') {
      award = 200 + level * 150
    } else {
      return NextResponse.json({ error: 'Invalid event' }, { status: 400 })
    }
    award = Math.max(0, Math.min(MAX_PER_REQUEST, award))
    if (award === 0) return NextResponse.json({ awarded: 0 })

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles').select('id, fp_balance').eq('clerk_user_id', userId).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const newBalance = profile.fp_balance + award
    const { error } = await admin.from('profiles').update({ fp_balance: newBalance }).eq('id', profile.id)
    if (error) throw error

    return NextResponse.json({ awarded: award, balance: newBalance })
  } catch (err) {
    console.error('landslide reward error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

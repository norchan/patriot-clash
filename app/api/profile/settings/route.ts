import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { sanitizeFighter } from '@/lib/fighter'

// PATCH /api/profile/settings — update player preferences
export async function PATCH(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const body = await req.json()

    const allowed = ['allow_pvp_messages', 'allow_messages', 'show_party']
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }
    // Fighter designs are validated against the allowed option sets
    if ('fighter' in body) {
      updates.fighter = sanitizeFighter(body.fighter, profile.id)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { error } = await admin
      .from('profiles')
      .update(updates)
      .eq('id', profile.id)

    if (error) throw error

    return NextResponse.json({ success: true, updated: updates })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

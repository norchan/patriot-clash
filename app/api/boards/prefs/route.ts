import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// PATCH /api/boards/prefs { order: string[], hidden: string[] } — the
// Organize pSubs page (Michael): custom tab order + switched-off pSubs,
// stored on the profile so it follows the account across devices.
// p/all can never be hidden (it's the landing tab).

const cleanSlugs = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
        .map(x => x.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64))
        .filter(Boolean)
        .slice(0, 100)
    : []

export async function PATCH(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const body = await req.json()
    const order = cleanSlugs(body.order)
    const hidden = cleanSlugs(body.hidden).filter(s => s !== 'all')
    const { error } = await admin.from('profiles')
      .update({ board_tab_prefs: { order, hidden } })
      .eq('id', profile.id)
    if (error) throw error
    return NextResponse.json({ ok: true, order, hidden })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('PATCH /api/boards/prefs error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

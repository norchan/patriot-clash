import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/cliques/leave — leave your current click
export async function POST(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { error } = await admin
      .from('profiles')
      .update({ clique_id: null, clique_pending_id: null })
      .eq('id', profile.id)

    if (error) throw error
    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

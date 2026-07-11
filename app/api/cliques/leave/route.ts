import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { deleteCliqueIfEmpty } from '@/lib/cliques'

// POST /api/cliques/leave — leave your current clique
export async function POST(_req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const leftCliqueId = (profile as any).clique_id ?? null

    const { error } = await admin
      .from('profiles')
      .update({ clique_id: null, clique_pending_id: null })
      .eq('id', profile.id)

    if (error) throw error

    // If that was the last member, the clique disappears
    if (leftCliqueId) await deleteCliqueIfEmpty(admin, leftCliqueId)

    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { deleteCliqueIfEmpty, removeCliqueMember } from '@/lib/cliques'

// POST /api/cliques/leave { clique_id? } — leave ONE of your cliques
// (multi-clique, Michael 2026-07-25). No body → leave your default. If the
// left clique was your default, your most recent other clique takes over as
// default automatically — you always have one while you're in any.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    let cliqueId: string | null = null
    try { cliqueId = (await req.json())?.clique_id ?? null } catch { /* no body */ }
    cliqueId = cliqueId ?? (profile as any).clique_id ?? null
    if (!cliqueId) return NextResponse.json({ error: 'Not in a clique' }, { status: 400 })

    await removeCliqueMember(admin, profile.id, cliqueId)
    // leaving also clears a pending request aimed at this clique
    await admin.from('profiles')
      .update({ clique_pending_id: null })
      .eq('id', profile.id)
      .eq('clique_pending_id', cliqueId)

    // If that was the last member, the clique disappears
    await deleteCliqueIfEmpty(admin, cliqueId)

    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

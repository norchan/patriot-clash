import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isCliqueMember } from '@/lib/cliques'

// POST /api/cliques/default { clique_id } — pick which of YOUR cliques is
// the default (Michael 2026-07-25). The default is what your profile shows,
// and its town hall becomes your home hall.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { clique_id } = await req.json()
    if (!clique_id) return NextResponse.json({ error: 'clique_id required' }, { status: 400 })

    if (!(await isCliqueMember(admin, profile.id, clique_id))) {
      return NextResponse.json({ error: 'Join that clique first' }, { status: 403 })
    }
    const { data: clique } = await admin.from('cliques').select('id, gym_id').eq('id', clique_id).single()
    const { error } = await admin.from('profiles')
      .update({ clique_id, ...(clique?.gym_id ? { home_gym_id: clique.gym_id } : {}) })
      .eq('id', profile.id)
    if (error) throw error
    return NextResponse.json({ ok: true, default_clique_id: clique_id })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

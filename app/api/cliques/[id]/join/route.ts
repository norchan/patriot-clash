import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isCliqueMember, addCliqueMember, isCliqueBanned } from '@/lib/cliques'

// POST /api/cliques/[id]/join — join a clique of your party, ANYWHERE in the
// country, and as many as you like (Michael 2026-07-25: multi-clique).
// Open cliques admit you immediately; request-only cliques queue you for the
// creator. Your first clique automatically becomes your default.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: clique } = await admin
      .from('cliques')
      .select('id, name, party, creator_id, join_policy, gym_id')
      .eq('id', id)
      .single()

    if (!clique) {
      return NextResponse.json({ error: 'Clique not found' }, { status: 404 })
    }
    if (clique.party !== profile.party) {
      return NextResponse.json({ error: 'You can only join cliques from your own party' }, { status: 403 })
    }
    if (await isCliqueBanned(admin, profile.id, clique.id)) {
      return NextResponse.json({ error: "You're banned from this clique" }, { status: 403 })
    }
    if (await isCliqueMember(admin, profile.id, clique.id)) {
      return NextResponse.json({ status: 'member', clique })
    }

    if (clique.join_policy === 'open') {
      await addCliqueMember(admin, profile.id, clique)
      return NextResponse.json({ status: 'member', clique })
    }
    const { error } = await admin.from('profiles')
      .update({ clique_pending_id: clique.id })
      .eq('id', profile.id)
    if (error) throw error
    return NextResponse.json({ status: 'requested', clique })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

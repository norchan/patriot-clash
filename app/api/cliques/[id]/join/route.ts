import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/cliques/[id]/join — join a clique of your party. Open cliques
// admit you immediately; request-only cliques queue you for the creator.
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
      .select('id, name, party, creator_id, join_policy')
      .eq('id', id)
      .single()

    if (!clique) {
      return NextResponse.json({ error: 'Clique not found' }, { status: 404 })
    }
    if (clique.party !== profile.party) {
      return NextResponse.json({ error: 'You can only join cliques from your own party' }, { status: 403 })
    }
    if ((profile as any).clique_id === clique.id) {
      return NextResponse.json({ status: 'member', clique })
    }
    if ((profile as any).clique_id) {
      return NextResponse.json({ error: 'Leave your current clique first' }, { status: 400 })
    }

    const openJoin = clique.join_policy === 'open'
    const { error } = await admin
      .from('profiles')
      .update(openJoin
        ? { clique_id: clique.id, clique_pending_id: null }
        : { clique_pending_id: clique.id })
      .eq('id', profile.id)

    if (error) throw error
    return NextResponse.json({ status: openJoin ? 'member' : 'requested', clique })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

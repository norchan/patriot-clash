import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/cliques/[id]/join — REQUEST to join a clique of your party.
// Membership starts when the clique's creator approves the request.
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
      .select('id, name, party, creator_id')
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

    const { error } = await admin
      .from('profiles')
      .update({ clique_pending_id: clique.id })
      .eq('id', profile.id)

    if (error) throw error
    return NextResponse.json({ status: 'requested', clique })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

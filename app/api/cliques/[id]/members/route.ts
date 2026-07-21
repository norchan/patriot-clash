import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { deleteCliqueIfEmpty } from '@/lib/cliques'

// POST /api/cliques/[id]/members — creator-only member management:
//   { profile_id, action: 'approve' | 'deny' | 'remove' }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { profile_id, action } = await req.json()

    if (!profile_id || !['approve', 'deny', 'remove'].includes(action)) {
      return NextResponse.json({ error: 'profile_id and a valid action are required' }, { status: 400 })
    }

    const { data: clique } = await admin
      .from('cliques')
      .select('id, creator_id, gym_id')
      .eq('id', id)
      .single()

    if (!clique) {
      return NextResponse.json({ error: 'Clique not found' }, { status: 404 })
    }
    if (clique.creator_id !== profile.id) {
      return NextResponse.json({ error: 'Only the clique creator can manage members' }, { status: 403 })
    }
    if (profile_id === clique.creator_id && action === 'remove') {
      return NextResponse.json({ error: 'The creator cannot remove themselves — leave instead' }, { status: 400 })
    }

    if (action === 'approve') {
      const { error } = await admin
        .from('profiles')
        // joining a clique adopts its town hall as the assigned home hall
        .update({ clique_id: id, clique_pending_id: null, home_gym_id: (clique as any).gym_id ?? undefined })
        .eq('id', profile_id)
        .eq('clique_pending_id', id)
      if (error) throw error
    } else if (action === 'deny') {
      const { error } = await admin
        .from('profiles')
        .update({ clique_pending_id: null })
        .eq('id', profile_id)
        .eq('clique_pending_id', id)
      if (error) throw error
    } else {
      const { error } = await admin
        .from('profiles')
        .update({ clique_id: null })
        .eq('id', profile_id)
        .eq('clique_id', id)
      if (error) throw error
      await deleteCliqueIfEmpty(admin, id)
    }

    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/cliques/[id] — clique details. The member roster is visible to
// MEMBERS ONLY; pending join requests are visible to the creator only.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: clique } = await admin
      .from('cliques')
      .select('id, name, party, gym_id, creator_id, created_at')
      .eq('id', id)
      .single()

    if (!clique) {
      return NextResponse.json({ error: 'Clique not found' }, { status: 404 })
    }

    const isMember = (profile as any).clique_id === clique.id
    const isCreator = clique.creator_id === profile.id

    const [{ data: gym }, { count: memberCount }] = await Promise.all([
      clique.gym_id
        ? admin.from('gyms').select('id, city_name, state, holder_party, defense_points').eq('id', clique.gym_id).single()
        : Promise.resolve({ data: null }),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('clique_id', id),
    ])

    let members: any[] = []
    if (isMember) {
      const { data } = await admin
        .from('profiles')
        .select('id, username, avatar_url, total_battles_won')
        .eq('clique_id', id)
        .order('total_battles_won', { ascending: false })
        .limit(100)
      members = data ?? []
    }

    let pending: any[] = []
    if (isCreator) {
      const { data } = await admin
        .from('profiles')
        .select('id, username, avatar_url')
        .eq('clique_pending_id', id)
        .limit(50)
      pending = data ?? []
    }

    return NextResponse.json({
      clique,
      gym,
      member_count: memberCount ?? 0,
      is_member: isMember,
      is_creator: isCreator,
      members,
      pending,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isCliqueMember } from '@/lib/cliques'

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
      .select('id, name, party, gym_id, creator_id, created_at, join_policy, banner_url, pow_wow_at')
      .eq('id', id)
      .single()

    if (!clique) {
      return NextResponse.json({ error: 'Clique not found' }, { status: 404 })
    }

    const isMember = await isCliqueMember(admin, profile.id, clique.id)
    const isCreator = clique.creator_id === profile.id
    const powWowLive = !!clique.pow_wow_at

    const [{ data: gym }, { count: memberCount }] = await Promise.all([
      clique.gym_id
        ? admin.from('gyms').select('id, city_name, state, holder_party, defense_points').eq('id', clique.gym_id).single()
        : Promise.resolve({ data: null }),
      admin.from('clique_members').select('clique_id', { count: 'exact', head: true }).eq('clique_id', id),
    ])

    // Roster: members-only normally; during a Pow-Wow EVERYONE sees it, with
    // pow-wow guests appended and flagged as non-members (Michael)
    let members: any[] = []
    let isGuest = false
    if (isMember || powWowLive) {
      const [{ data }, { data: guestRows }] = await Promise.all([
        admin
          .from('clique_members')
          .select('profiles(id, username, avatar_url, total_battles_won)')
          .eq('clique_id', id)
          .limit(100),
        powWowLive
          ? admin.from('clique_pow_wow_guests')
              .select('profile_id, profiles(id, username, avatar_url, total_battles_won)')
              .eq('clique_id', id)
              .limit(200)
          : Promise.resolve({ data: [] as any[] }),
      ])
      members = (data ?? []).map((m: any) => m.profiles).filter(Boolean)
        .sort((a: any, b: any) => (b.total_battles_won ?? 0) - (a.total_battles_won ?? 0))
      const guests = (guestRows ?? []).map((g: any) => g.profiles).filter(Boolean)
        .map((g: any) => ({ ...g, pow_wow_guest: true }))
      isGuest = (guestRows ?? []).some((g: any) => g.profile_id === profile.id)
      members = [...members, ...guests]
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
      is_default: (profile as any).clique_id === clique.id,
      is_creator: isCreator,
      pow_wow: powWowLive,
      is_pow_wow_guest: isGuest,
      members,
      pending,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

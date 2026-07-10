import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/cliques — clicks of YOUR party only, with member counts.
// Optional ?q= filters by name.
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const q = req.nextUrl.searchParams.get('q')?.trim()
    const gymId = req.nextUrl.searchParams.get('gym_id')

    let query = admin
      .from('cliques')
      .select('id, name, party, gym_id, creator_id, created_at, join_policy, banner_url')
      .order('created_at', { ascending: false })
      .limit(50)

    // Hall view shows local cliques of BOTH parties; the browse list stays
    // scoped to your own party
    if (gymId) query = query.eq('gym_id', gymId)
    else query = query.eq('party', profile.party)

    if (q) query = query.ilike('name', `%${q}%`)

    const { data: cliques, error } = await query
    if (error) throw error

    // Member counts (single pass over profiles' clique_id values)
    const ids = (cliques ?? []).map(c => c.id)
    const counts: Record<string, number> = {}
    if (ids.length > 0) {
      for (let from = 0; ; from += 1000) {
        const { data: members } = await admin
          .from('profiles')
          .select('clique_id')
          .in('clique_id', ids)
          .range(from, from + 999)
        if (!members?.length) break
        for (const m of members) counts[m.clique_id] = (counts[m.clique_id] || 0) + 1
        if (members.length < 1000) break
      }
    }

    return NextResponse.json({
      cliques: (cliques ?? []).map(c => ({ ...c, member_count: counts[c.id] || 0 })),
      my_clique_id: (profile as any).clique_id ?? null,
      my_pending_id: (profile as any).clique_pending_id ?? null,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/cliques — create a click tied to a town hall. The hall's name is
// appended to whatever name the creator picks. Creator auto-joins.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { name, gym_id } = await req.json()
    const trimmed = (name ?? '').trim()
    if (!trimmed || trimmed.length > 30) {
      return NextResponse.json({ error: 'Name must be 1-30 characters' }, { status: 400 })
    }
    if (!gym_id) {
      return NextResponse.json({ error: 'Pick a town hall' }, { status: 400 })
    }

    const { data: gym } = await admin
      .from('gyms')
      .select('id, city_name, state')
      .eq('id', gym_id)
      .single()

    if (!gym) {
      return NextResponse.json({ error: 'Town hall not found' }, { status: 404 })
    }

    const fullName = `${trimmed} — ${gym.city_name}`

    const { data: clique, error } = await admin
      .from('cliques')
      .insert({
        name: fullName,
        gym_id: gym.id,
        party: profile.party,
        creator_id: profile.id,
      })
      .select()
      .single()

    if (error) throw error

    // Creator joins their new clique immediately (no approval needed)
    await admin.from('profiles').update({ clique_id: clique.id, clique_pending_id: null }).eq('id', profile.id)

    return NextResponse.json({ clique })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/cliques error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

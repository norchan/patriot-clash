import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isCliqueModerator } from '@/lib/cliques'

// POST /api/cliques/[id]/ban { profile_id, duration: '24h' | '1w' | 'perma' }
//      or { profile_id, action: 'unban' }
// Creator + moderators can ban. Nobody bans the creator; only the creator
// can ban a moderator. Banning strips membership + pow-wow guest status and
// blocks rejoining while the ban is active.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { profile_id, duration, action } = await req.json()
    if (!profile_id) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    const { data: clique } = await admin
      .from('cliques').select('id, creator_id').eq('id', id).single()
    if (!clique) return NextResponse.json({ error: 'Clique not found' }, { status: 404 })

    const isCreator = clique.creator_id === profile.id
    const amMod = isCreator || await isCliqueModerator(admin, profile.id, id)
    if (!amMod) return NextResponse.json({ error: 'Only the creator and moderators can do that' }, { status: 403 })

    if (action === 'unban') {
      await admin.from('clique_bans').delete().eq('clique_id', id).eq('profile_id', profile_id)
      return NextResponse.json({ banned: false })
    }

    if (!['24h', '1w', 'perma'].includes(duration)) {
      return NextResponse.json({ error: 'Pick a ban length' }, { status: 400 })
    }
    if (profile_id === clique.creator_id) {
      return NextResponse.json({ error: 'The creator cannot be banned' }, { status: 400 })
    }
    if (profile_id === profile.id) {
      return NextResponse.json({ error: "You can't ban yourself" }, { status: 400 })
    }
    // only the creator can ban a moderator (and doing so demods them)
    if (!isCreator && await isCliqueModerator(admin, profile_id, id)) {
      return NextResponse.json({ error: 'Only the creator can ban a moderator' }, { status: 403 })
    }

    const until = duration === '24h'
      ? new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      : duration === '1w'
        ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
        : null

    await admin.from('clique_bans')
      .upsert({ clique_id: id, profile_id, banned_by: profile.id, until }, { onConflict: 'clique_id,profile_id' })

    // strip them out: membership, mod status, pow-wow guest slot
    await Promise.all([
      admin.from('clique_members').delete().eq('clique_id', id).eq('profile_id', profile_id),
      admin.from('clique_moderators').delete().eq('clique_id', id).eq('profile_id', profile_id),
      admin.from('clique_pow_wow_guests').delete().eq('clique_id', id).eq('profile_id', profile_id),
    ])
    // if this clique was their default, hand the default to another membership
    const { data: prof } = await admin.from('profiles').select('clique_id').eq('id', profile_id).maybeSingle()
    if (prof?.clique_id === id) {
      const { data: next } = await admin.from('clique_members')
        .select('clique_id').eq('profile_id', profile_id)
        .order('joined_at', { ascending: false }).limit(1).maybeSingle()
      await admin.from('profiles').update({ clique_id: next?.clique_id ?? null }).eq('id', profile_id)
    }

    return NextResponse.json({ banned: true, until })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/cliques/[id]/ban error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

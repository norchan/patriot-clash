import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isCliqueMember } from '@/lib/cliques'

// POST /api/cliques/[id]/moderators { profile_id, action: 'add' | 'remove' }
// Creator only. Moderators (+ the creator) can ban players from the clique.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { profile_id, action } = await req.json()
    if (!profile_id || !['add', 'remove'].includes(action)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    }

    const { data: clique } = await admin
      .from('cliques').select('id, creator_id').eq('id', id).single()
    if (!clique) return NextResponse.json({ error: 'Clique not found' }, { status: 404 })
    if (clique.creator_id !== profile.id) {
      return NextResponse.json({ error: 'Only the clique creator manages moderators' }, { status: 403 })
    }
    if (profile_id === profile.id) {
      return NextResponse.json({ error: "You're the creator — already top mod" }, { status: 400 })
    }

    if (action === 'add') {
      if (!(await isCliqueMember(admin, profile_id, id))) {
        return NextResponse.json({ error: 'Moderators must be clique members' }, { status: 400 })
      }
      await admin.from('clique_moderators')
        .upsert({ clique_id: id, profile_id }, { onConflict: 'clique_id,profile_id' })
      return NextResponse.json({ moderator: true })
    }

    await admin.from('clique_moderators').delete().eq('clique_id', id).eq('profile_id', profile_id)
    return NextResponse.json({ moderator: false })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/cliques/[id]/moderators error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { isCliqueMember, powWowIsLive } from '@/lib/cliques'

// POST /api/cliques/[id]/powwow { action: 'start' | 'end' | 'join' }
// Pow-Wow (Michael): the creator opens the clique to EVERYONE — anyone can
// view and chat. start/end = creator only; join = any signed-in player
// while a pow-wow is live (guests appear in the member list as non-members).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { action } = await req.json()

    const { data: clique } = await admin
      .from('cliques')
      .select('id, name, creator_id, pow_wow_at')
      .eq('id', id)
      .single()
    if (!clique) return NextResponse.json({ error: 'Clique not found' }, { status: 404 })

    if (action === 'start' || action === 'end') {
      if (clique.creator_id !== profile.id) {
        return NextResponse.json({ error: 'Only the clique creator can run a Pow-Wow' }, { status: 403 })
      }
      if (action === 'start') {
        await admin.from('cliques').update({ pow_wow_at: new Date().toISOString() }).eq('id', id)
        return NextResponse.json({ pow_wow: true })
      }
      // end: close the doors and clear the guest list
      await admin.from('cliques').update({ pow_wow_at: null }).eq('id', id)
      await admin.from('clique_pow_wow_guests').delete().eq('clique_id', id)
      return NextResponse.json({ pow_wow: false })
    }

    if (action === 'join') {
      if (!powWowIsLive(clique.pow_wow_at)) {
        return NextResponse.json({ error: 'No Pow-Wow running right now' }, { status: 400 })
      }
      if (await isCliqueMember(admin, profile.id, id)) {
        return NextResponse.json({ joined: true, member: true })
      }
      await admin.from('clique_pow_wow_guests')
        .upsert({ clique_id: id, profile_id: profile.id }, { onConflict: 'clique_id,profile_id' })
      return NextResponse.json({ joined: true, member: false })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/cliques/[id]/powwow error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

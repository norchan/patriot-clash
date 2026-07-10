import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { BANNER_URLS } from '@/config/banners'

// PATCH /api/cliques/[id]/settings { join_policy?, banner_url? }
// Creator-only: open vs request-to-join, and the page banner.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { join_policy, banner_url } = await req.json()

    const { data: clique } = await admin
      .from('cliques')
      .select('id, creator_id')
      .eq('id', id)
      .single()

    if (!clique) return NextResponse.json({ error: 'Clique not found' }, { status: 404 })
    if (clique.creator_id !== profile.id) {
      return NextResponse.json({ error: 'Only the creator can change settings' }, { status: 403 })
    }

    const updates: Record<string, unknown> = {}

    if (join_policy !== undefined) {
      if (join_policy !== 'open' && join_policy !== 'request') {
        return NextResponse.json({ error: 'join_policy must be open or request' }, { status: 400 })
      }
      updates.join_policy = join_policy
      // Switching to open admits everyone already waiting
      if (join_policy === 'open') {
        await admin.from('profiles')
          .update({ clique_id: id, clique_pending_id: null })
          .eq('clique_pending_id', id)
      }
    }

    if (banner_url !== undefined) {
      // Only presets — arbitrary URLs would let a creator embed anything
      if (banner_url !== null && !BANNER_URLS.has(banner_url)) {
        return NextResponse.json({ error: 'Unknown banner' }, { status: 400 })
      }
      updates.banner_url = banner_url
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data: updated, error } = await admin
      .from('cliques')
      .update(updates)
      .eq('id', id)
      .select('id, join_policy, banner_url')
      .single()

    if (error) throw error
    return NextResponse.json({ clique: updated })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('PATCH /api/cliques/[id]/settings error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

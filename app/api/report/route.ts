import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const TARGET_TYPES = new Set(['hall_post', 'hall_comment', 'player', 'clique_post'])

// POST /api/report { target_type, target_id, reason?, reported_profile_id? }
// Community reporting: one report per player per target; a hall post that
// collects 3 distinct reporters is auto-hidden pending review.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { target_type, target_id, reason, reported_profile_id } = await req.json()

    if (!TARGET_TYPES.has(target_type) || !target_id) {
      return NextResponse.json({ error: 'Invalid report target' }, { status: 400 })
    }

    // One report per player per target
    const { data: existing } = await admin
      .from('moderation_reports')
      .select('id')
      .eq('kind', 'user_report')
      .eq('target_type', target_type)
      .eq('target_id', String(target_id))
      .eq('reporter_id', profile.id)
      .maybeSingle()
    if (existing) return NextResponse.json({ ok: true, already: true })

    await admin.from('moderation_reports').insert({
      kind: 'user_report',
      target_type,
      target_id: String(target_id),
      reporter_id: profile.id,
      reported_profile_id: reported_profile_id ?? null,
      reason: (reason ?? '').slice(0, 300) || null,
    })

    // Auto-hide hall posts at 3+ distinct reporters
    if (target_type === 'hall_post') {
      const { count } = await admin
        .from('moderation_reports')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'user_report')
        .eq('target_type', 'hall_post')
        .eq('target_id', String(target_id))
      if ((count ?? 0) >= 3) {
        await admin.from('hall_posts').update({ hidden: true }).eq('id', target_id)
      }
    }

    return NextResponse.json({ ok: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/report error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

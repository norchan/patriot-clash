import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateText } from '@/lib/moderation'

// POST /api/reels/post { path, caption? } — turn a finished storage upload
// (from /api/reels/upload-url) into a p/videos post that plays in the reels
// pager. The path must be the caller's own reels/<profileId>/ slot.

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { path, caption } = await req.json()

    if (typeof path !== 'string' || !path.startsWith(`reels/${profile.id}/`) || !/\.(mp4|webm|mov)$/i.test(path)) {
      return NextResponse.json({ error: 'Bad upload path' }, { status: 400 })
    }
    // the upload must actually exist before we point a post at it
    const dir = path.slice(0, path.lastIndexOf('/'))
    const name = path.slice(path.lastIndexOf('/') + 1)
    const { data: files } = await admin.storage.from('avatars').list(dir, { search: name })
    if (!files?.some(f => f.name === name)) {
      return NextResponse.json({ error: 'Upload not found — try again' }, { status: 400 })
    }

    const text = (caption ?? '').trim().slice(0, 300)
    if (text) {
      const verdict = await moderateText(text)
      if (!verdict.allowed) return NextResponse.json({ error: verdict.reason ?? 'Caption rejected' }, { status: 400 })
    }

    const { data: board } = await admin.from('boards').select('id').eq('slug', 'videos').maybeSingle()
    if (!board) return NextResponse.json({ error: 'videos board missing' }, { status: 500 })

    const publicUrl = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl
    const { data: post, error } = await admin.from('hall_posts').insert({
      board_id: board.id,
      profile_id: profile.id,
      party: profile.party ?? null,
      content: text || '🎬 New reel',
      link_url: publicUrl,
      link_title: text || null,
      link_domain: 'politicsgo.app',
    }).select('id').single()
    if (error) throw error

    return NextResponse.json({ ok: true, post_id: post.id })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/reels/post error:', err)
    return NextResponse.json({ error: 'Could not post the reel' }, { status: 500 })
  }
}

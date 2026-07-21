import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fetchLinkPreview, firstUrl } from '@/lib/link-preview'
import { moderateText, moderateImage, recordCsamSuspect } from '@/lib/moderation'

// POST /api/boards/[slug]/posts { content, image?, link_url? } — post to a
// psub. Same moderation/image/link pipeline as town-hall posts. Local psubs
// are the halls themselves — posting to those happens at the hall.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { slug } = await params

    const { data: board } = await admin.from('boards')
      .select('id, slug, category, gym_id')
      .eq('slug', slug.toLowerCase())
      .maybeSingle()
    if (!board) return NextResponse.json({ error: 'No such board' }, { status: 404 })
    if (board.category === 'local') {
      return NextResponse.json({ error: 'Post at the town hall itself' }, { status: 400 })
    }

    const { content, image, link_url } = await req.json()
    const text = (content ?? '').trim()
    if (text.length > 1000) {
      return NextResponse.json({ error: 'Post is too long (1000 characters max)' }, { status: 400 })
    }

    const textVerdict = await moderateText(text)
    if (!textVerdict.allowed) {
      return NextResponse.json({ error: textVerdict.reason ?? 'Post rejected' }, { status: 400 })
    }
    if (image) {
      const imgVerdict = await moderateImage(image, 'post_image')
      if (!imgVerdict.allowed) {
        if (imgVerdict.csamSuspected) {
          await recordCsamSuspect(admin, { profileId: profile.id, targetType: 'board_post_image', details: imgVerdict.details })
        }
        return NextResponse.json({ error: imgVerdict.reason ?? 'Image rejected' }, { status: 400 })
      }
    }

    let imageUrl: string | null = null
    if (image) {
      const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(image)
      if (!match) return NextResponse.json({ error: 'Unsupported image' }, { status: 400 })
      const buffer = Buffer.from(match[2], 'base64')
      if (buffer.length > 2.5 * 1024 * 1024) {
        return NextResponse.json({ error: 'Image too large (max 2.5 MB)' }, { status: 400 })
      }
      const path = `boards/${board.id}/${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
      const { error: upErr } = await admin.storage
        .from('avatars')
        .upload(path, buffer, { contentType: `image/${match[1]}`, upsert: false })
      if (upErr) {
        console.error('board image upload failed:', upErr)
        return NextResponse.json({ error: 'Image upload failed' }, { status: 500 })
      }
      imageUrl = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl
    }

    let preview = null
    const url = (link_url ?? '').trim() || (text ? firstUrl(text) : null)
    if (url && !imageUrl) preview = await fetchLinkPreview(url)

    if (!text && !imageUrl) {
      return NextResponse.json({ error: 'Say something or attach an image' }, { status: 400 })
    }

    const { data: post, error } = await admin
      .from('hall_posts')
      .insert({
        board_id: board.id,
        profile_id: profile.id,
        party: profile.party ?? null,
        content: text || null,
        image_url: imageUrl,
        link_url: preview?.url ?? null,
        link_title: preview?.title ?? null,
        link_image: preview?.image ?? null,
        link_domain: preview?.domain ?? null,
      })
      .select('id, profile_id, party, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at')
      .single()
    if (error) throw error

    return NextResponse.json({
      post: {
        ...post,
        username: profile.username,
        avatar_url: (profile as any).avatar_url ?? null,
        my_vote: 0,
        is_mine: true,
      },
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/boards/[slug]/posts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

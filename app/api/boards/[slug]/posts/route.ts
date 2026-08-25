import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fetchLinkPreview, firstUrl } from '@/lib/link-preview'
import { moderateText, moderateImage, recordCsamSuspect } from '@/lib/moderation'
import { videoEmbed, videoAvailable } from '@/lib/video-embed'
import { resolvePBoard } from '@/lib/boards'

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

    // Resolve the target — real board row OR a VIRTUAL board (p/all, p/democrats,
    // p/republicans). The party windows have no table row: a post "to
    // p/democrats" is a party-tagged hall_posts row with board_id=null, which
    // the party feed reads. (Fixes: virtual boards 404'd on POST — readable but
    // not postable.)
    const rb = await resolvePBoard(admin, slug)
    if (!rb) return NextResponse.json({ error: 'No such board' }, { status: 404 })
    let targetBoardId: string | null = null
    let postParty: string | null = profile.party ?? null
    if (rb.kind === 'all') {
      return NextResponse.json({ error: 'Post to a specific board — p/all is a mix of every board' }, { status: 400 })
    } else if (rb.kind === 'party') {
      // party window: only the matching side may post (a post shows in its own
      // party feed, so cross-posting would just vanish for the author)
      if (profile.party !== rb.key) {
        return NextResponse.json({ error: `p/${rb.key}s is for ${rb.key === 'democrat' ? 'Democrats' : 'Republicans'}` }, { status: 403 })
      }
      postParty = rb.key
      // hall_posts requires a target (gym_id OR board_id); the party feed still
      // reads by party regardless, but we anchor to the party's board row so
      // the CHECK constraint is satisfied (scripts/ensure_party_boards.mjs)
      const partySlug = rb.key === 'democrat' ? 'democrats' : 'republicans'
      const { data: pb } = await admin.from('boards').select('id').eq('slug', partySlug).maybeSingle()
      if (!pb) return NextResponse.json({ error: 'Party board missing' }, { status: 500 })
      targetBoardId = pb.id
    } else {
      const board = rb.board
      if (board.category === 'local') {
        return NextResponse.json({ error: 'Post at the town hall itself' }, { status: 400 })
      }
      targetBoardId = board.id
    }

    const { content, image, images, link_url } = await req.json()
    const text = (content ?? '').trim()
    // 8,000 chars: a 4-8 paragraph desk article fits (was 1,000 — Grok brief
    // 2026-08-24). moderateText reads the first 4,000 of it.
    if (text.length > 8000) {
      return NextResponse.json({ error: 'Post is too long (8,000 characters max)' }, { status: 400 })
    }

    const textVerdict = await moderateText(text)
    if (!textVerdict.allowed) {
      return NextResponse.json({ error: textVerdict.reason ?? 'Post rejected' }, { status: 400 })
    }

    // 1-2 stills per post via `images: []` (the composer), or the legacy
    // single `image` field — SAME pipeline for each: moderation → size gate →
    // the existing public bucket path. No second storage system.
    const stills: string[] = (Array.isArray(images) ? images : image ? [image] : [])
      .filter((s: unknown) => typeof s === 'string' && s.length > 0)
      .slice(0, 2)
    for (const im of stills) {
      const imgVerdict = await moderateImage(im, 'post_image')
      if (!imgVerdict.allowed) {
        if (imgVerdict.csamSuspected) {
          await recordCsamSuspect(admin, { profileId: profile.id, targetType: 'board_post_image', details: imgVerdict.details })
        }
        return NextResponse.json({ error: imgVerdict.reason ?? 'Image rejected' }, { status: 400 })
      }
    }

    const stillUrls: string[] = []
    for (const im of stills) {
      const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(im)
      if (!match) return NextResponse.json({ error: 'Unsupported image' }, { status: 400 })
      const buffer = Buffer.from(match[2], 'base64')
      if (buffer.length > 2.5 * 1024 * 1024) {
        return NextResponse.json({ error: 'Image too large (max 2.5 MB)' }, { status: 400 })
      }
      const path = `boards/${targetBoardId ?? rb.kind}/${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
      const { error: upErr } = await admin.storage
        .from('avatars')
        .upload(path, buffer, { contentType: `image/${match[1]}`, upsert: false })
      if (upErr) {
        console.error('board image upload failed:', upErr)
        return NextResponse.json({ error: 'Image upload failed' }, { status: 500 })
      }
      stillUrls.push(admin.storage.from('avatars').getPublicUrl(path).data.publicUrl)
    }
    const imageUrl: string | null = stillUrls[0] ?? null
    const imageUrl2: string | null = stillUrls[1] ?? null

    let preview = null
    const url = (link_url ?? '').trim() || (text ? firstUrl(text) : null)
    // videos must actually be embeddable — copyright-blocked/deleted videos
    // would render as a dead "Video unavailable" frame (Michael's rule)
    if (url && videoEmbed(url) && !(await videoAvailable(url))) {
      return NextResponse.json({ error: 'That video can\'t be embedded (blocked or removed by its owner) — try a different one' }, { status: 400 })
    }
    if (url && !imageUrl) preview = await fetchLinkPreview(url)

    if (!text && !imageUrl) {
      return NextResponse.json({ error: 'Say something or attach an image' }, { status: 400 })
    }

    const { data: post, error } = await admin
      .from('hall_posts')
      .insert({
        board_id: targetBoardId,
        profile_id: profile.id,
        party: postParty,
        content: text || null,
        image_url: imageUrl,
        image_url2: imageUrl2,
        link_url: preview?.url ?? null,
        link_title: preview?.title ?? null,
        link_image: preview?.image ?? null,
        link_domain: preview?.domain ?? null,
      })
      .select('id, profile_id, party, content, image_url, image_url2, link_url, link_title, link_image, link_domain, score, comment_count, created_at')
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

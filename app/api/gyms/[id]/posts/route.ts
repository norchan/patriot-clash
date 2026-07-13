import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fetchLinkPreview, firstUrl } from '@/lib/link-preview'
import { moderateText, moderateImage, recordCsamSuspect } from '@/lib/moderation'

// Town hall discussion feed — public to every player (halls are the public
// squares of the game). Posts carry text, an uploaded image, or a link
// with a scraped preview card.

// GET /api/gyms/[id]/posts?sort=top|local|new — top (default) is the most
// upvoted of the last 24 hours; local is the top-ranked posts marked "local"
// in the last 48 hours; new is latest-first
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const sortParam = req.nextUrl.searchParams.get('sort')
    const sort = sortParam === 'new' ? 'new' : sortParam === 'local' ? 'local' : 'top'

    let q = admin
      .from('hall_posts')
      .select('id, profile_id, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at, nsfw, local')
      .eq('gym_id', id)
      .eq('hidden', false)
    if (sort === 'top') {
      q = q.gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
    } else if (sort === 'local') {
      // posts flagged local, highest-ranked in the last 48 hours first
      q = q.eq('local', true)
        .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
    } else {
      q = q.order('created_at', { ascending: false })
    }
    const { data: posts } = await q.limit(80)

    if (!posts?.length) return NextResponse.json({ posts: [] })

    const authorIds = [...new Set(posts.map(p => p.profile_id))]
    const postIds = posts.map(p => p.id)
    const [{ data: authors }, { data: myVotes }] = await Promise.all([
      admin.from('profiles').select('id, username, avatar_url, party').in('id', authorIds),
      admin.from('hall_post_votes').select('post_id, vote').eq('profile_id', profile.id).in('post_id', postIds),
    ])
    const byId = Object.fromEntries((authors ?? []).map(a => [a.id, a]))
    const voteById = Object.fromEntries((myVotes ?? []).map(v => [v.post_id, v.vote]))

    return NextResponse.json({
      posts: posts.map(p => ({
        ...p,
        username: byId[p.profile_id]?.username ?? 'Unknown',
        avatar_url: byId[p.profile_id]?.avatar_url ?? null,
        party: byId[p.profile_id]?.party ?? null,
        my_vote: voteById[p.id] ?? 0,
        is_mine: p.profile_id === profile.id,
      })),
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/gyms/[id]/posts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/gyms/[id]/posts { content, image?, link_url? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { content, image, link_url, local } = await req.json()
    const text = (content ?? '').trim()
    if (text.length > 1000) {
      return NextResponse.json({ error: 'Post is too long (1000 characters max)' }, { status: 400 })
    }

    // Screen text + image before anything is stored (Town Square is public)
    const textVerdict = await moderateText(text)
    if (!textVerdict.allowed) {
      return NextResponse.json({ error: textVerdict.reason ?? 'Post rejected' }, { status: 400 })
    }
    if (image) {
      const imgVerdict = await moderateImage(image, 'post_image')
      if (!imgVerdict.allowed) {
        if (imgVerdict.csamSuspected) {
          await recordCsamSuspect(admin, { profileId: profile.id, targetType: 'hall_post_image', details: imgVerdict.details })
        }
        return NextResponse.json({ error: imgVerdict.reason ?? 'Image rejected' }, { status: 400 })
      }
    }

    // Uploaded image (meme/photo) — same pipeline as clique posts
    let imageUrl: string | null = null
    if (image) {
      const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(image)
      if (!match) return NextResponse.json({ error: 'Unsupported image' }, { status: 400 })
      const buffer = Buffer.from(match[2], 'base64')
      if (buffer.length > 2.5 * 1024 * 1024) {
        return NextResponse.json({ error: 'Image too large (max 2.5 MB)' }, { status: 400 })
      }
      const path = `halls/${id}/${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
      const { error: upErr } = await admin.storage
        .from('avatars')
        .upload(path, buffer, { contentType: `image/${match[1]}`, upsert: false })
      if (upErr) {
        console.error('hall image upload failed:', upErr)
        return NextResponse.json({ error: 'Image upload failed' }, { status: 500 })
      }
      imageUrl = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl
    }

    // Link preview: explicit link_url, or the first URL found in the text
    let preview = null
    const url = (link_url ?? '').trim() || (text ? firstUrl(text) : null)
    if (url && !imageUrl) preview = await fetchLinkPreview(url)

    if (!text && !imageUrl) {
      return NextResponse.json({ error: 'Say something or attach an image' }, { status: 400 })
    }

    const { data: post, error } = await admin
      .from('hall_posts')
      .insert({
        gym_id: id,
        profile_id: profile.id,
        content: text || null,
        image_url: imageUrl,
        link_url: preview?.url ?? null,
        link_title: preview?.title ?? null,
        link_image: preview?.image ?? null,
        link_domain: preview?.domain ?? null,
        local: !!local,
      })
      .select('id, profile_id, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at, nsfw, local')
      .single()

    if (error) throw error
    return NextResponse.json({
      post: {
        ...post,
        username: profile.username,
        avatar_url: (profile as any).avatar_url ?? null,
        party: profile.party,
        my_vote: 0,
        is_mine: true,
      },
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/posts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateText, moderateImage, recordCsamSuspect } from '@/lib/moderation'
import { powWowIsLive, isCliqueBanned } from '@/lib/cliques'

// Clique feed — MEMBERS ONLY, both read and write... EXCEPT during a
// Pow-Wow (Michael): while one is live, ANYONE can read the chat, and
// pow-wow guests (non-members who tapped Join) can post too.

async function powWowLive(admin: any, cliqueId: string): Promise<boolean> {
  const { data } = await admin.from('cliques').select('pow_wow_at').eq('id', cliqueId).maybeSingle()
  return powWowIsLive(data?.pow_wow_at)
}

// read access: member, or any signed-in player while a pow-wow is live.
// Banned players are out regardless.
async function assertReader(admin: any, profile: any, cliqueId: string) {
  if (await isCliqueBanned(admin, profile.id, cliqueId)) {
    throw NextResponse.json({ error: "You're banned from this clique" }, { status: 403 })
  }
  const { data } = await admin.from('clique_members')
    .select('clique_id').eq('clique_id', cliqueId).eq('profile_id', profile.id).maybeSingle()
  if (data) return
  if (await powWowLive(admin, cliqueId)) return
  throw NextResponse.json({ error: 'Only clique members can see this feed' }, { status: 403 })
}

// write access: member, or a joined pow-wow guest while one is live — and
// only if the owner's rules allow guest chat (else guests are read-only)
async function assertPoster(admin: any, profile: any, cliqueId: string) {
  if (await isCliqueBanned(admin, profile.id, cliqueId)) {
    throw NextResponse.json({ error: "You're banned from this clique" }, { status: 403 })
  }
  const { data } = await admin.from('clique_members')
    .select('clique_id').eq('clique_id', cliqueId).eq('profile_id', profile.id).maybeSingle()
  if (data) return
  const { data: cq } = await admin.from('cliques')
    .select('pow_wow_at, pow_wow_guest_chat').eq('id', cliqueId).maybeSingle()
  if (powWowIsLive(cq?.pow_wow_at)) {
    if (cq?.pow_wow_guest_chat === false) {
      throw NextResponse.json({ error: 'Chat is read-only for Pow-Wow guests here' }, { status: 403 })
    }
    const { data: guest } = await admin.from('clique_pow_wow_guests')
      .select('clique_id').eq('clique_id', cliqueId).eq('profile_id', profile.id).maybeSingle()
    if (guest) return
    throw NextResponse.json({ error: 'Join the Pow-Wow to chat' }, { status: 403 })
  }
  throw NextResponse.json({ error: 'Only clique members can post here' }, { status: 403 })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    await assertReader(admin, profile, id)

    const { data: posts } = await admin
      .from('clique_posts')
      .select('id, profile_id, content, image_url, score, created_at')
      .eq('clique_id', id)
      .order('created_at', { ascending: false })
      .limit(60)

    const authorIds = [...new Set((posts ?? []).map((p: any) => p.profile_id))]
    const postIds = (posts ?? []).map((p: any) => p.id)
    const [{ data: authors }, { data: myVotes }] = await Promise.all([
      authorIds.length
        ? admin.from('profiles').select('id, username, avatar_url').in('id', authorIds)
        : Promise.resolve({ data: [] as any[] }),
      postIds.length
        ? admin.from('clique_post_votes').select('post_id, vote').eq('profile_id', profile.id).in('post_id', postIds)
        : Promise.resolve({ data: [] as any[] }),
    ])
    const byId = Object.fromEntries((authors ?? []).map((a: any) => [a.id, a]))
    const voteById = Object.fromEntries((myVotes ?? []).map((v: any) => [v.post_id, v.vote]))

    return NextResponse.json({
      posts: (posts ?? []).map((p: any) => ({
        ...p,
        username: byId[p.profile_id]?.username ?? 'Unknown',
        avatar_url: byId[p.profile_id]?.avatar_url ?? null,
        my_vote: voteById[p.id] ?? 0,
        is_mine: p.profile_id === profile.id,
      })),
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/cliques/[id]/posts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    await assertPoster(admin, profile, id)

    const { content, image } = await req.json()
    const text = (content ?? '').trim()

    const textVerdict = await moderateText(text)
    if (!textVerdict.allowed) {
      return NextResponse.json({ error: textVerdict.reason ?? 'Post rejected' }, { status: 400 })
    }
    if (image) {
      const imgVerdict = await moderateImage(image, 'post_image')
      if (!imgVerdict.allowed) {
        if (imgVerdict.csamSuspected) {
          await recordCsamSuspect(admin, { profileId: profile.id, targetType: 'clique_post_image', details: imgVerdict.details })
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
      const path = `cliques/${id}/${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
      const { error: upErr } = await admin.storage
        .from('avatars')
        .upload(path, buffer, { contentType: `image/${match[1]}`, upsert: false })
      if (upErr) {
        console.error('clique image upload failed:', upErr)
        return NextResponse.json({ error: 'Image upload failed' }, { status: 500 })
      }
      imageUrl = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl
    }

    if (!text && !imageUrl) {
      return NextResponse.json({ error: 'Say something or post an image' }, { status: 400 })
    }
    if (text.length > 800) {
      return NextResponse.json({ error: 'Post is too long (800 characters max)' }, { status: 400 })
    }

    const { data: post, error } = await admin
      .from('clique_posts')
      .insert({ clique_id: id, profile_id: profile.id, content: text || null, image_url: imageUrl })
      .select('id, profile_id, content, image_url, score, created_at')
      .single()

    if (error) throw error
    return NextResponse.json({
      post: { ...post, username: profile.username, avatar_url: (profile as any).avatar_url ?? null, my_vote: 0, is_mine: true },
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/cliques/[id]/posts error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/cliques/[id]/posts?post=<uuid> — author or clique creator
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const postId = req.nextUrl.searchParams.get('post')
    if (!postId) return NextResponse.json({ error: 'post id required' }, { status: 400 })

    const [{ data: post }, { data: clique }] = await Promise.all([
      admin.from('clique_posts').select('id, profile_id').eq('id', postId).eq('clique_id', id).maybeSingle(),
      admin.from('cliques').select('creator_id').eq('id', id).single(),
    ])
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (post.profile_id !== profile.id && clique?.creator_id !== profile.id) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    await admin.from('clique_posts').delete().eq('id', postId)
    return NextResponse.json({ deleted: postId })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

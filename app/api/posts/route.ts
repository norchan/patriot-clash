import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateText, moderateImage } from '@/lib/moderation'

// GET /api/posts?profile_id=... — a profile's post feed (defaults to your own)
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const profileId = req.nextUrl.searchParams.get('profile_id') || profile.id

    const { data: posts, error } = await admin
      .from('profile_posts')
      .select('id, profile_id, content, score, created_at, media_url, media_type')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) throw error

    const ids = (posts ?? []).map(p => p.id)
    const { data: myVotes } = ids.length
      ? await admin.from('profile_post_votes').select('post_id, vote').eq('profile_id', profile.id).in('post_id', ids)
      : { data: [] as any[] }
    const voteById = Object.fromEntries((myVotes ?? []).map((v: any) => [v.post_id, v.vote]))

    return NextResponse.json({ posts: (posts ?? []).map(p => ({ ...p, my_vote: voteById[p.id] ?? 0 })) })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/posts — publish a post (text, and/or a pic/GIF, and/or a video)
//   image     : base64 data URL for a pic or GIF (small — goes through here)
//   video_url : an already-uploaded video URL (big files use the signed
//               upload at /api/posts/upload-url to bypass the API size limit)
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { content, image, video_url } = await req.json()
    const text = (content ?? '').trim()
    if (text.length > 500) {
      return NextResponse.json({ error: 'Post is too long (500 characters max)' }, { status: 400 })
    }
    if (!text && !image && !video_url) {
      return NextResponse.json({ error: 'Say something or add a photo/video' }, { status: 400 })
    }
    if (text) {
      const verdict = await moderateText(text)
      if (!verdict.allowed) return NextResponse.json({ error: verdict.reason ?? 'Post rejected' }, { status: 400 })
    }

    let mediaUrl: string | null = null
    let mediaType: 'image' | 'video' | null = null

    // Pic / GIF via base64
    if (image) {
      const imgVerdict = await moderateImage(image, 'post_image')
      if (!imgVerdict.allowed) return NextResponse.json({ error: imgVerdict.reason ?? 'Image rejected' }, { status: 400 })
      const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(image)
      if (!match) return NextResponse.json({ error: 'Unsupported image' }, { status: 400 })
      const buffer = Buffer.from(match[2], 'base64')
      if (buffer.length > 4 * 1024 * 1024) return NextResponse.json({ error: 'Image too large (max 4 MB)' }, { status: 400 })
      const path = `posts/${profile.id}/${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
      const { error: upErr } = await admin.storage.from('avatars').upload(path, buffer, { contentType: `image/${match[1]}`, upsert: false })
      if (upErr) return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
      mediaUrl = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl
      mediaType = 'image'
    } else if (video_url) {
      // Only accept videos we hosted (uploaded via the signed URL below)
      const base = admin.storage.from('avatars').getPublicUrl('').data.publicUrl
      if (typeof video_url !== 'string' || !video_url.startsWith(base) || !video_url.includes('/posts/')) {
        return NextResponse.json({ error: 'Invalid video' }, { status: 400 })
      }
      mediaUrl = video_url
      mediaType = 'video'
    }

    const { data: post, error } = await admin
      .from('profile_posts')
      .insert({ profile_id: profile.id, content: text || null, media_url: mediaUrl, media_type: mediaType })
      .select('id, profile_id, content, score, created_at, media_url, media_type')
      .single()

    if (error) throw error
    return NextResponse.json({ post: { ...post, my_vote: 0 } })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

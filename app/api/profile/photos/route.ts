import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateImage, recordCsamSuspect } from '@/lib/moderation'

const MAX_PHOTOS = 12

// GET  /api/profile/photos            — your own album
// POST /api/profile/photos { image }  — add a photo (base64 data URL)
// DELETE /api/profile/photos?id=<id>  — remove one

export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { data } = await admin
      .from('profile_photos')
      .select('id, url, created_at')
      .eq('profile_id', profile.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    return NextResponse.json({ photos: data ?? [] })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { image } = await req.json()

    const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(image ?? '')
    if (!match) return NextResponse.json({ error: 'Expected a base64 image' }, { status: 400 })
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length > 3 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 3 MB)' }, { status: 400 })
    }

    // Screen before anything touches storage. Album photos use the adult-
    // allowed policy (nudity OK, sexual acts not) when that switch is on.
    const verdict = await moderateImage(image, 'album')
    if (!verdict.allowed) {
      if (verdict.csamSuspected) {
        await recordCsamSuspect(admin, { profileId: profile.id, targetType: 'profile_photo', details: verdict.details })
      }
      return NextResponse.json({ error: verdict.reason ?? 'Image rejected' }, { status: 400 })
    }

    const { count } = await admin
      .from('profile_photos')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
    if ((count ?? 0) >= MAX_PHOTOS) {
      return NextResponse.json({ error: `Album is full (${MAX_PHOTOS} photos max)` }, { status: 400 })
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const path = `albums/${profile.id}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await admin.storage
      .from('avatars')
      .upload(path, buffer, { contentType: `image/${match[1]}`, upsert: false })
    if (upErr) {
      console.error('album upload failed:', upErr)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
    const url = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl

    const { data: photo, error } = await admin
      .from('profile_photos')
      .insert({ profile_id: profile.id, url, sort_order: count ?? 0 })
      .select('id, url, created_at')
      .single()
    if (error) throw error

    // Their first-ever photo doubles as the profile picture when they
    // don't have one yet
    let avatarSet = false
    if ((count ?? 0) === 0 && !(profile as any).avatar_url) {
      await admin.from('profiles').update({ avatar_url: url }).eq('id', profile.id)
      avatarSet = true
    }

    return NextResponse.json({ photo, avatar_set: avatarSet })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/profile/photos error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const photoId = req.nextUrl.searchParams.get('id')
    if (!photoId) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data: gone } = await admin
      .from('profile_photos')
      .delete()
      .eq('id', photoId)
      .eq('profile_id', profile.id)
      .select('url')
      .maybeSingle()
    if (!gone) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

    // Best-effort storage cleanup
    const marker = '/avatars/'
    const idx = gone.url.indexOf(marker)
    if (idx >= 0) {
      const path = gone.url.slice(idx + marker.length).split('?')[0]
      await admin.storage.from('avatars').remove([path]).catch(() => {})
    }
    return NextResponse.json({ deleted: photoId })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

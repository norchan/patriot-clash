import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateImage, recordCsamSuspect } from '@/lib/moderation'

// POST /api/profile/photo — upload a profile photo (base64 data URL).
// The client resizes to 256x256 before sending, so payloads stay small.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { image } = await req.json()
    const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(image ?? '')
    if (!match) {
      return NextResponse.json({ error: 'Expected a base64 image data URL' }, { status: 400 })
    }

    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length > 1.5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 1.5 MB)' }, { status: 400 })
    }

    // Avatars are always SFW — they show on the public map
    const verdict = await moderateImage(image, 'avatar')
    if (!verdict.allowed) {
      if (verdict.csamSuspected) {
        await recordCsamSuspect(admin, { profileId: profile.id, targetType: 'avatar', details: verdict.details })
      }
      return NextResponse.json({ error: verdict.reason ?? 'Image rejected' }, { status: 400 })
    }

    const path = `${profile.id}.jpg`
    const { error: uploadErr } = await admin.storage
      .from('avatars')
      .upload(path, buffer, { contentType: `image/${match[1]}`, upsert: true })

    if (uploadErr) {
      console.error('avatar upload failed:', uploadErr)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    // Cache-bust so the new photo shows immediately everywhere
    const { data: pub } = admin.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`

    const { error: updateErr } = await admin
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', profile.id)

    if (updateErr) throw updateErr

    return NextResponse.json({ avatar_url: avatarUrl })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/profile/photo error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/posts/upload-url { ext } — returns a one-time signed upload URL so
// the browser can push a video straight to storage (Vercel's API body limit is
// too small for videos). The resulting public URL is then posted to /api/posts.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { ext } = await req.json()
    const clean = String(ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!['mp4', 'mov', 'webm', 'm4v'].includes(clean)) {
      return NextResponse.json({ error: 'Unsupported video type' }, { status: 400 })
    }
    const path = `posts/${profile.id}/${crypto.randomUUID()}.${clean}`
    const { data, error } = await admin.storage.from('avatars').createSignedUploadUrl(path)
    if (error || !data) return NextResponse.json({ error: 'Could not create upload URL' }, { status: 500 })

    const publicUrl = admin.storage.from('avatars').getPublicUrl(path).data.publicUrl
    return NextResponse.json({ path: data.path, token: data.token, publicUrl })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

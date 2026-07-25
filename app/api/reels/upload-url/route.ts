import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/reels/upload-url { ext } — a one-time signed upload slot for a
// player's OWN reel video (recorded or uploaded original — the embed-only
// rule protects other platforms' content, not the user's own footage).
// The client streams the file straight to Supabase storage with the token
// (serverless bodies can't carry video), then registers it via /api/reels/post.

const EXTS = new Set(['mp4', 'webm', 'mov'])

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { ext } = await req.json()
    if (!EXTS.has(ext)) return NextResponse.json({ error: 'mp4, webm or mov only' }, { status: 400 })

    const path = `reels/${profile.id}/${crypto.randomUUID()}.${ext}`
    const { data, error } = await admin.storage.from('avatars').createSignedUploadUrl(path)
    if (error || !data) throw error ?? new Error('no signed url')
    return NextResponse.json({ path: data.path, token: data.token })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/reels/upload-url error:', err)
    return NextResponse.json({ error: 'Could not start upload' }, { status: 500 })
  }
}

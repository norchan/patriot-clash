import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// GET /api/posts?profile_id=... — a profile's post feed (defaults to your own)
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const profileId = req.nextUrl.searchParams.get('profile_id') || profile.id

    const { data: posts, error } = await admin
      .from('profile_posts')
      .select('id, profile_id, content, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) throw error
    return NextResponse.json({ posts })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/posts — publish a post to your own profile
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { content } = await req.json()
    if (!content?.trim() || content.length > 500) {
      return NextResponse.json({ error: 'Post must be 1-500 characters' }, { status: 400 })
    }

    const { data: post, error } = await admin
      .from('profile_posts')
      .insert({ profile_id: profile.id, content: content.trim() })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ post })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

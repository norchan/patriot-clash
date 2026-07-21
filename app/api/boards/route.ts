import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { moderateText } from '@/lib/moderation'
import { slugifyBoard } from '@/lib/boards'

// POST /api/boards { name } — create a community psub (category 'user').
// Max 3 new psubs per player per day.

const RESERVED = new Set([
  'all', 'profile', 'democrats', 'democrat', 'dems', 'republicans', 'republican', 'reps',
  'create', 'new', 'admin', 'mod', 'politicsgo',
])

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const { name } = await req.json()
    const clean = (name ?? '').trim().replace(/\s+/g, ' ')
    if (clean.length < 3 || clean.length > 42) {
      return NextResponse.json({ error: 'Name must be 3–42 characters' }, { status: 400 })
    }
    const slug = slugifyBoard(clean)
    if (slug.length < 3 || RESERVED.has(slug)) {
      return NextResponse.json({ error: 'That name is not available' }, { status: 400 })
    }
    const verdict = await moderateText(clean)
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason ?? 'Name rejected' }, { status: 400 })
    }

    const { count } = await admin.from('boards')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', profile.id)
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    if ((count ?? 0) >= 3) {
      return NextResponse.json({ error: 'Limit reached — 3 new psubs per day' }, { status: 429 })
    }

    const { data: existing } = await admin.from('boards').select('slug').eq('slug', slug).maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'That psub already exists', slug }, { status: 409 })
    }

    const { data: board, error } = await admin.from('boards')
      .insert({ slug, name: clean, category: 'user', created_by: profile.id })
      .select('slug, name')
      .single()
    if (error) throw error
    return NextResponse.json({ board })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/boards error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

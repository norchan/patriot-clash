import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ captured: false })

    const { searchParams } = new URL(req.url)
    const enemy_id = searchParams.get('enemy_id')
    if (!enemy_id) return NextResponse.json({ captured: false })

    const admin = createSupabaseAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('clerk_user_id', userId)
      .single()

    if (!profile) return NextResponse.json({ captured: false })

    const { count } = await admin
      .from('captured_characters')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
      .eq('enemy_id', enemy_id)

    return NextResponse.json({ captured: (count ?? 0) > 0, count: count ?? 0 })

  } catch {
    return NextResponse.json({ captured: false })
  }
}
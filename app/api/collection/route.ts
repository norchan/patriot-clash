import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ collection: [] })

    const admin = createSupabaseAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('clerk_user_id', userId)
      .single()

    if (!profile) return NextResponse.json({ collection: [] })

    const { data: collection } = await admin
      .from('captured_characters')
      .select('*')
      .eq('profile_id', profile.id)
      .order('captured_at', { ascending: false })

    return NextResponse.json({ collection: collection || [] })

  } catch (err) {
    return NextResponse.json({ collection: [] })
  }
}
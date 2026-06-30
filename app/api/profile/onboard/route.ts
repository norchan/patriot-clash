import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { party } = await req.json()

    if (!['democrat', 'republican'].includes(party)) {
      return NextResponse.json({ error: 'Invalid party' }, { status: 400 })
    }

    await admin
      .from('profiles')
      .update({ party })
      .eq('id', profile.id)

    return NextResponse.json({ success: true, party })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
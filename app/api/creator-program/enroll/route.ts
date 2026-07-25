import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/creator-program/enroll — enroll user in creator program
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { agreed_to_terms } = await req.json()

    if (!agreed_to_terms) {
      return NextResponse.json({ error: 'Must agree to terms' }, { status: 400 })
    }

    // Check if already enrolled
    const { data: existing } = await admin
      .from('creator_program')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ enrolled: true, message: 'Already enrolled' })
    }

    // Create enrollment record
    const { data, error } = await admin
      .from('creator_program')
      .insert({
        profile_id: profile.id,
        agreed_to_terms: true,
        status: 'pending_kyc', // pending_kyc → kyc_verified → active
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ enrolled: true, data })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('Error enrolling in creator program:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

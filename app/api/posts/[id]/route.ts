import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// DELETE /api/posts/[id] — delete your own post
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { error } = await admin
      .from('profile_posts')
      .delete()
      .eq('id', id)
      .eq('profile_id', profile.id)

    if (error) throw error
    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

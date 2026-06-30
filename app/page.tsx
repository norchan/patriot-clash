import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

export default async function HomePage() {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  const admin = createSupabaseAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, party')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) {
    const { createProfileForUser } = await import('@/lib/auth')
    await createProfileForUser(userId, '', `player_${userId.slice(-6)}`)
    redirect('/onboarding')
  }

  redirect('/map')
}
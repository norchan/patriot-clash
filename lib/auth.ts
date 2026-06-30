import { auth, currentUser } from '@clerk/nextjs/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from './supabase-server'

// =============================================================================
// AUTH HELPERS
// Shared utilities for getting the current user and their game profile.
// =============================================================================

// Get the current user's game profile from Supabase
export async function getCurrentProfile() {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('clerk_user_id', userId)
    .single()

  if (error || !data) return null
  return data
}

// Get profile or throw a 401 response — use in protected API routes
export async function requireProfile() {
  const profile = await getCurrentProfile()
  if (!profile) {
    throw new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }
  return profile
}

// Create a profile for a new Clerk user (called by webhook)
export async function createProfileForUser(clerkUserId: string, email: string, username: string) {
  const admin = createSupabaseAdminClient()

  // Check if profile already exists
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .single()

  if (existing) return existing

  // Create new profile — party is set during onboarding
  const { data, error } = await admin
    .from('profiles')
    .insert({
      clerk_user_id: clerkUserId,
      username: username || email.split('@')[0],
      party: 'democrat', // default, changed during onboarding
      fp_balance: 50,    // starter FP gift
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// Update FCM device token for push notifications
export async function updateDeviceToken(clerkUserId: string, token: string) {
  const admin = createSupabaseAdminClient()
  await admin
    .from('profiles')
    .update({ device_token: token })
    .eq('clerk_user_id', clerkUserId)
}

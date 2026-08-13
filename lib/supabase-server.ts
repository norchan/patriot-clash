import { createClient } from '@supabase/supabase-js'
import { auth } from '@clerk/nextjs/server'

// ⚠️ SECURITY (2026-08-12): BOTH clients below use the SERVICE ROLE KEY and
// therefore BYPASS Row-Level Security entirely. There is no per-user scoping
// at the database layer — every query runs with full-admin privilege.
// CONSEQUENCE: any route touching another user's data MUST enforce ownership
// in application code (e.g. `.eq('profile_id', profile.id)` or a fetch-then-
// check-then-mutate). Do NOT assume RLS will catch a missing filter — it
// won't. `createSupabaseServerClient` and `createSupabaseAdminClient` are the
// same privilege today; the name difference is historical, not a security
// boundary.
export async function createSupabaseServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

// Admin client — bypasses RLS
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
import { createClient } from '@supabase/supabase-js'

// =============================================================================
// SUPABASE BROWSER CLIENT
// Use this in React client components ('use client').
// For authenticated requests, use the server client instead.
// =============================================================================
export function createSupabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

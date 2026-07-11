import type { SupabaseClient } from '@supabase/supabase-js'

// Deletes a clique if it has no members left. Called whenever someone leaves
// or is removed, so an emptied clique never lingers (its shell would block
// re-creation and leave request-only cliques with nobody to approve joins).
// Pending join requests to the dead clique are cleared too.
export async function deleteCliqueIfEmpty(admin: SupabaseClient, cliqueId: string): Promise<boolean> {
  const { count } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('clique_id', cliqueId)

  if ((count ?? 0) > 0) return false

  // Clear anyone still waiting on this now-dead clique, then remove it.
  // clique_posts and the gym's clique link cascade / are safe to drop.
  await admin.from('profiles').update({ clique_pending_id: null }).eq('clique_pending_id', cliqueId)
  await admin.from('cliques').delete().eq('id', cliqueId)
  return true
}

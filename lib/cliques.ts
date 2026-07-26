import type { SupabaseClient } from '@supabase/supabase-js'

// Multi-clique membership helpers (Michael 2026-07-25): membership lives in
// clique_members (a player can join many, anywhere in the country);
// profiles.clique_id is the DEFAULT clique pointer.

// Pow-Wows run at most 12 hours (Michael): a pg_cron sweep nulls stale
// pow_wow_at every 10 min; this check keeps reads honest between ticks.
export const POW_WOW_MAX_HOURS = 12
export function powWowIsLive(powWowAt: string | null | undefined): boolean {
  if (!powWowAt) return false
  return Date.now() - new Date(powWowAt).getTime() < POW_WOW_MAX_HOURS * 3600 * 1000
}

/** Is this profile a member of this clique? */
export async function isCliqueMember(admin: SupabaseClient, profileId: string, cliqueId: string): Promise<boolean> {
  const { data } = await admin
    .from('clique_members')
    .select('clique_id')
    .eq('clique_id', cliqueId)
    .eq('profile_id', profileId)
    .maybeSingle()
  return !!data
}

/** Add a membership; if the player has no default clique yet, this one
 *  becomes it (everyone always has a default once they're in any clique)
 *  and its town hall becomes their home hall. */
export async function addCliqueMember(admin: SupabaseClient, profileId: string, clique: { id: string; gym_id?: string | null }): Promise<void> {
  await admin.from('clique_members')
    .upsert({ clique_id: clique.id, profile_id: profileId }, { onConflict: 'clique_id,profile_id' })
  const { data: prof } = await admin.from('profiles').select('clique_id').eq('id', profileId).maybeSingle()
  if (prof && !prof.clique_id) {
    await admin.from('profiles')
      .update({ clique_id: clique.id, ...(clique.gym_id ? { home_gym_id: clique.gym_id } : {}) })
      .eq('id', profileId)
  }
}

/** Remove a membership. If it was the player's default, the most recent
 *  remaining membership takes over as default (or none). */
export async function removeCliqueMember(admin: SupabaseClient, profileId: string, cliqueId: string): Promise<void> {
  await admin.from('clique_members').delete().eq('clique_id', cliqueId).eq('profile_id', profileId)
  const { data: prof } = await admin.from('profiles').select('clique_id').eq('id', profileId).maybeSingle()
  if (prof?.clique_id === cliqueId) {
    const { data: next } = await admin.from('clique_members')
      .select('clique_id, cliques(gym_id)')
      .eq('profile_id', profileId)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    await admin.from('profiles')
      .update({
        clique_id: next?.clique_id ?? null,
        ...((next as any)?.cliques?.gym_id ? { home_gym_id: (next as any).cliques.gym_id } : {}),
      })
      .eq('id', profileId)
  }
}

// Deletes a clique if it has no members left. Called whenever someone leaves
// or is removed, so an emptied clique never lingers (its shell would block
// re-creation and leave request-only cliques with nobody to approve joins).
// Pending join requests to the dead clique are cleared too.
export async function deleteCliqueIfEmpty(admin: SupabaseClient, cliqueId: string): Promise<boolean> {
  const { count } = await admin
    .from('clique_members')
    .select('clique_id', { count: 'exact', head: true })
    .eq('clique_id', cliqueId)

  if ((count ?? 0) > 0) return false

  // Clear anyone still waiting on this now-dead clique, then remove it.
  // clique_posts and the gym's clique link cascade / are safe to drop.
  await admin.from('profiles').update({ clique_pending_id: null }).eq('clique_pending_id', cliqueId)
  await admin.from('profiles').update({ clique_id: null }).eq('clique_id', cliqueId)
  await admin.from('cliques').delete().eq('id', cliqueId)
  return true
}

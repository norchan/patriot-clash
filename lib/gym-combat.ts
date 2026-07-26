import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CAPTURE_BASE_DEFENSE,
  CAPTURE_DEFENSE_PER_CLIQUE,
} from '@/config/siege-balance'

/**
 * Apply siege damage to a held hall. Defense floors at 0 (not 1).
 * When remaining hits 0 the hall is captured — kills the old "stuck at 1
 * until a second march" limbo from strike/boost floors.
 *
 * Caller validates range, party, FP/item spend first. Pass fresh
 * defense_points from the gyms table (not a possibly-stale nearby RPC).
 */
export async function applyHallDamageAndMaybeCapture(
  admin: SupabaseClient,
  opts: {
    gymId: string
    cityName: string
    holderId: string | null
    defensePoints: number
    damage: number
    attacker: { id: string; username: string; party: 'democrat' | 'republican' }
    latitude: number
    longitude: number
  },
): Promise<{ damage: number; remaining: number; captured: boolean }> {
  const before = Math.max(0, Math.floor(opts.defensePoints))
  const rolled = Math.max(0, Math.floor(opts.damage))
  const remaining = Math.max(0, before - rolled)
  const dealt = before - remaining
  // Any lethal hit (or already-zero held hall) falls
  const captured = remaining <= 0

  if (!captured) {
    await admin.from('gyms').update({ defense_points: remaining }).eq('id', opts.gymId)
    return { damage: dealt, remaining, captured: false }
  }

  await admin.rpc('capture_gym', {
    p_gym_id: opts.gymId,
    p_profile_id: opts.attacker.id,
    p_party: opts.attacker.party,
    p_latitude: opts.latitude,
    p_longitude: opts.longitude,
  })

  // Always seed some defense so the next flip isn't free
  const { data: allyCliques } = await admin
    .from('cliques')
    .select('id')
    .eq('gym_id', opts.gymId)
    .eq('party', opts.attacker.party)
  const startDefense =
    CAPTURE_BASE_DEFENSE + (allyCliques?.length ?? 0) * CAPTURE_DEFENSE_PER_CLIQUE
  await admin.from('gyms').update({ defense_points: startDefense }).eq('id', opts.gymId)

  if (opts.holderId) {
    await admin.from('notification_queue').insert({
      profile_id: opts.holderId,
      title: '🏛️ Town Hall Lost!',
      body: `${opts.attacker.username} captured ${opts.cityName} Town Hall!`,
      data: { gym_id: opts.gymId, type: 'gym_captured' },
    })
  }

  return {
    damage: dealt > 0 ? dealt : Math.max(rolled, before, 1),
    remaining: 0,
    captured: true,
  }
}

import { createSupabaseAdminClient } from '@/lib/supabase-server'
import type { HallDot } from '@/components/BattleMap'

// All active town halls as map dots (paginated past the 1000-row cap).
// Used by the homepage and /battlemap.
export async function fetchHalls(): Promise<HallDot[]> {
  const admin = createSupabaseAdminClient()
  const halls: HallDot[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('gyms')
      .select('id, latitude, longitude, holder_party, city_name, state')
      .eq('is_active', true)
      .range(from, from + 999)
    if (!data?.length) break
    halls.push(...data.map((g: any) => ({
      id: g.id, lat: g.latitude, lng: g.longitude, party: g.holder_party, city: g.city_name, state: g.state,
    })))
    if (data.length < 1000) break
  }
  return halls
}

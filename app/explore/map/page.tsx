import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import BattleMap, { type HallDot } from './BattleMap'

// THE PUBLIC BATTLE MAP — every capturable town hall in America, live-colored
// by which party holds it. Revalidates every 10 minutes.
export const revalidate = 600

export const metadata: Metadata = {
  title: 'The PoliticsGo Battle Map — live national map war',
  description:
    'The live national battle map: 2,000+ real American town halls colored by which party controls them in PoliticsGo right now. Find your town.',
  alternates: { canonical: 'https://politicsgo.app/explore/map' },
}

export default async function PublicMapPage() {
  const admin = createSupabaseAdminClient()
  const halls: HallDot[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('gyms')
      .select('latitude, longitude, holder_party, city_name, state')
      .eq('is_active', true)
      .range(from, from + 999)
    if (!data?.length) break
    halls.push(...data.map((g: any) => ({
      lat: g.latitude, lng: g.longitude, party: g.holder_party, city: g.city_name, state: g.state,
    })))
    if (data.length < 1000) break
  }
  const dem = halls.filter(h => h.party === 'democrat').length
  const rep = halls.filter(h => h.party === 'republican').length

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col">
      <div className="max-w-5xl w-full mx-auto px-4 pt-6 pb-3">
        <nav className="text-sm text-gray-500 mb-3 flex items-center justify-between">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
          <Link href="/explore/scoreboard" className="hover:text-white">📊 State-by-state numbers →</Link>
        </nav>
        <h1 className="text-2xl sm:text-3xl font-black text-white">🗺️ The Battle Map</h1>
        <div className="mt-2 flex items-center gap-4 text-sm font-black">
          <span className="text-blue-400">🔵 Democrats {dem.toLocaleString()}</span>
          <span className="text-red-400">🔴 Republicans {rep.toLocaleString()}</span>
          <span className="text-gray-500 font-bold text-xs">{halls.length.toLocaleString()} town halls · live</span>
        </div>
      </div>
      <div className="flex-1 min-h-[65vh] max-w-5xl w-full mx-auto px-4 pb-6">
        <div className="w-full h-full min-h-[65vh] rounded-2xl overflow-hidden border border-gray-800">
          <BattleMap halls={halls} />
        </div>
        <p className="text-center text-gray-600 text-xs mt-3">
          Every dot is a real town hall. <Link href="/" className="text-purple-400 hover:text-purple-300 font-bold">Sign up free</Link> to fight for yours.
        </p>
      </div>
    </div>
  )
}

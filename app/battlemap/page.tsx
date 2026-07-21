import Link from 'next/link'
import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fetchHalls } from '@/lib/halls'
import BattleMap from '@/components/BattleMap'

// THE PUBLIC BATTLE MAP — every capturable town hall in America, live-colored
// by which party holds it, linked Ingress-style into party territory webs.

export const metadata: Metadata = {
  title: 'The PoliticsGo Battle Map — live national map war',
  description:
    'The live national battle map: 2,000+ real American town halls colored by which party controls them in PoliticsGo right now. Find your town.',
  alternates: { canonical: 'https://politicsgo.app/battlemap' },
}

export default async function BattleMapPage() {
  const { userId } = await auth()
  let homeGymId: string | null = null
  if (userId) {
    const admin = createSupabaseAdminClient()
    const { data } = await admin.from('profiles').select('home_gym_id').eq('clerk_user_id', userId).maybeSingle()
    homeGymId = data?.home_gym_id ?? null
  }
  const halls = await fetchHalls()
  const dem = halls.filter(h => h.party === 'democrat').length
  const rep = halls.filter(h => h.party === 'republican').length

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-5xl w-full mx-auto px-4 pt-6 pb-6">
        <nav className="text-sm text-gray-500 mb-3 flex items-center justify-between">
          <Link href="/" className="hover:text-white">← Home</Link>
          <Link href="/explore/scoreboard" className="hover:text-white">📊 State-by-state numbers →</Link>
        </nav>
        <h1 className="text-2xl sm:text-3xl font-black text-white text-center">Battle Map</h1>
        <div className="mt-2 mb-4 flex items-center gap-4 text-sm font-black">
          <span className="text-blue-400">🔵 Democrats {dem.toLocaleString()}</span>
          <span className="text-red-400">🔴 Republicans {rep.toLocaleString()}</span>
          <span className="text-gray-500 font-bold text-xs">{halls.length.toLocaleString()} town halls · live</span>
        </div>
        <BattleMap halls={halls} height="70vh" signedIn={!!userId} homeGymId={homeGymId} />
        <p className="text-center text-gray-600 text-xs mt-3">
          Every dot is a real town hall — lines and fields show party territory.{' '}
          <Link href="/sign-up" className="text-purple-400 hover:text-purple-300 font-bold">Sign up free</Link> to fight for yours.
        </p>
      </div>
    </div>
  )
}

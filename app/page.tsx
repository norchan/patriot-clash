import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fetchHalls } from '@/lib/halls'
import BattleMap from '@/components/BattleMap'
import HomeMenu from '@/components/HomeMenu'
import HomeAvatarMenu from '@/components/HomeAvatarMenu'

// THE HOMEPAGE — the live national Battle Map, free for everyone.
// Under the map: JOIN THE FIGHT (location chooser → into the game) and the
// white icon dock (Boards · arcade · profile · town hall · messages). The
// boards live on /boards now, not here (Michael 2026-07-23).
// (Installed apps skip this — manifest start_url is /map.)

export default async function HomePage() {
  const { userId } = await auth()
  const admin = createSupabaseAdminClient()

  let profile: any = null
  if (userId) {
    const { data } = await admin
      .from('profiles')
      .select('id, username, party, onboarded, fp_balance, avatar_url, total_battles_won, home_gym_id, gyms!profiles_home_gym_id_fkey(latitude, longitude)')
      .eq('clerk_user_id', userId)
      .single()
    if (!data) {
      const { createProfileForUser } = await import('@/lib/auth')
      await createProfileForUser(userId, '', `player_${userId.slice(-6)}`)
      redirect('/onboarding')
    }
    // new players must pick a party (+ gender) before the game — party alone
    // can't gate this: the column is NOT NULL and defaults to democrat, which
    // is exactly why everyone looked like a democrat. The onboarded flag does.
    if (!data.onboarded) redirect('/onboarding')
    profile = data
  }

  const halls = await fetchHalls()
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* header */}
      <header className="border-b border-gray-800/70 bg-gray-950/80 sticky top-0 z-30 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HomeMenu signedIn={!!profile} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className="font-black text-white text-lg">PoliticsGo</span>
          </div>
          <div className="flex items-center gap-2.5">
            {!profile && (
              <nav className="flex items-center gap-1.5">
                <Link href="/sign-in" className="px-2 py-2 text-sm font-bold text-gray-400 hover:text-white whitespace-nowrap">Sign in</Link>
                <Link href="/sign-up" className="px-3 py-2 rounded-xl font-black text-white text-sm whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                  Play free
                </Link>
              </nav>
            )}
            {/* avatar menu (Michael): party-ringed profile pic → Profile /
                Local Players; guests get the white PGO circle → sign-up →
                local players */}
            <HomeAvatarMenu signedIn={!!profile} avatarUrl={profile?.avatar_url ?? null}
              party={profile?.party ?? null} username={profile?.username ?? null} />
          </div>
        </div>
      </header>

      {/* single column: the map + Join the Fight + icon dock */}
      <main className="max-w-2xl mx-auto px-4 py-5 min-w-0">
        {/* stats moved INTO the map's zoom stack (top button) — Michael */}
        <h1 className="mb-2 text-xl sm:text-2xl font-black text-white text-center">Battle Map</h1>
        {/* map fills the screen downward — the button + icon dock ride just
            above the bottom (where the ad bar will eventually live) */}
        <BattleMap halls={halls} height="max(46vh, calc(100dvh - 350px))" signedIn={!!profile} homeGymId={profile?.home_gym_id ?? null}
          homeCenter={profile?.gyms ? { lat: profile.gyms.latitude, lng: profile.gyms.longitude } : null} />
      </main>
    </div>
  )
}

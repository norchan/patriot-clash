import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fetchHalls } from '@/lib/halls'
import BattleMap from '@/components/BattleMap'
import BoardsDeck from '@/components/BoardsDeck'

// THE HOMEPAGE — the live national Battle Map, free for everyone.
// Signed-out: sign-up pitch sidebar. Signed-in: your profile sidebar.
// Below the map: the psub boards deck (reddit-app style). Other sidebar: arcade.
// (Installed apps skip this — manifest start_url is /map.)

export default async function HomePage() {
  const { userId } = await auth()
  const admin = createSupabaseAdminClient()

  let profile: any = null
  if (userId) {
    const { data } = await admin
      .from('profiles')
      .select('id, username, party, fp_balance, avatar_url, total_battles_won, home_gym_id')
      .eq('clerk_user_id', userId)
      .single()
    if (!data) {
      const { createProfileForUser } = await import('@/lib/auth')
      await createProfileForUser(userId, '', `player_${userId.slice(-6)}`)
      redirect('/onboarding')
    }
    if (!data.party) redirect('/onboarding')
    profile = data
  }

  // subscribed psubs join the boards-deck tab strip
  let subTabs: string[] = []
  if (profile) {
    const { data: subs } = await admin.from('board_subscriptions')
      .select('boards(slug)')
      .eq('profile_id', profile.id)
      .order('created_at')
    subTabs = (subs ?? []).map((s: any) => s.boards?.slug).filter(Boolean)
  }

  const [halls, { data: posts }] = await Promise.all([
    fetchHalls(),
    admin.from('hall_posts')
      .select('id, content, image_url, link_title, link_domain, score, comment_count, created_at, party, profiles!hall_posts_profile_id_fkey(username), gyms!hall_posts_gym_id_fkey(city_name, state)')
      .eq('hidden', false)
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(25),
  ])
  const deckPosts = (posts ?? []).map((p: any) => ({
    id: p.id, content: p.content, image_url: p.image_url,
    link_title: p.link_title, link_domain: p.link_domain,
    score: p.score, comment_count: p.comment_count, created_at: p.created_at,
    party: p.party, username: p.profiles?.username ?? 'Player',
    city: p.gyms?.city_name ?? null, state: p.gyms?.state ?? null,
  }))
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* header */}
      <header className="border-b border-gray-800/70 bg-gray-950/80 sticky top-0 z-30 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className="font-black text-white text-lg">PoliticsGo</span>
          </div>
          {!profile && (
            <nav className="flex items-center gap-2">
              <Link href="/sign-in" className="px-3 py-2 text-sm font-bold text-gray-400 hover:text-white">Sign in</Link>
              <Link href="/sign-up" className="px-4 py-2 rounded-xl font-black text-white text-sm"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                Play free
              </Link>
            </nav>
          )}
        </div>
      </header>

      {/* single column: collapsible map on top, boards below (no sidebars) */}
      <main className="max-w-2xl mx-auto px-4 py-5 min-w-0">
        <h1 className="text-xl sm:text-2xl font-black text-white mb-2 text-center">Battle Map</h1>
        <BattleMap halls={halls} height="56vh" signedIn={!!profile} homeGymId={profile?.home_gym_id ?? null} collapsible />

        <h2 className="mt-6 mb-2 text-lg font-black text-white">📰 Boards</h2>
        <BoardsDeck signedIn={!!profile} initialPosts={deckPosts} extraTabs={subTabs} />
      </main>
    </div>
  )
}

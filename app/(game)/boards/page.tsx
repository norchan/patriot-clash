import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import BoardsDeck from '@/components/BoardsDeck'
import ScrollTopButton from '@/components/ScrollTopButton'

// /boards — the boards deck full-page. Mobile: the deck alone (game ☰ rides
// below the tab strip). Desktop rails (menu left / profile right) come from
// the game layout's DesktopRails like every other page — one geometry.

export default async function BoardsPage() {
  const { userId } = await auth()
  const admin = createSupabaseAdminClient()

  let profile: any = null
  let subTabs: string[] = []
  if (userId) {
    const { data: prof } = await admin.from('profiles')
      .select('id, username, party, avatar_url, fp_balance, total_battles_won, board_tab_prefs')
      .eq('clerk_user_id', userId).maybeSingle()
    profile = prof ?? null
    if (profile) {
      const { data: subs } = await admin.from('board_subscriptions')
        .select('boards(slug)')
        .eq('profile_id', profile.id)
        .order('created_at')
      subTabs = (subs ?? []).map((s: any) => s.boards?.slug).filter(Boolean)
    }
  }

  const { data: posts } = await admin.from('hall_posts')
    .select('id, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at, party, impressions, profiles!hall_posts_profile_id_fkey(username, avatar_url), gyms!hall_posts_gym_id_fkey(city_name, state)')
    .eq('hidden', false)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)

  const deckPosts = (posts ?? []).map((p: any) => ({
    id: p.id, content: p.content, image_url: p.image_url,
    link_title: p.link_title, link_domain: p.link_domain,
    link_url: p.link_url, link_image: p.link_image,
    score: p.score, comment_count: p.comment_count, impressions: p.impressions ?? 0, created_at: p.created_at,
    party: p.party, username: p.profiles?.username ?? 'Player',
    avatar_url: p.profiles?.avatar_url ?? null,
    city: p.gyms?.city_name ?? null, state: p.gyms?.state ?? null,
  }))

  return (
    <div className="min-h-screen bg-gray-950">
      <BoardsDeck signedIn={!!profile} initialPosts={deckPosts} extraTabs={subTabs} swipeNav tall tabPrefs={profile?.board_tab_prefs ?? null} />
      {/* blue Top ↑ pill floats over the feed's lower right, all devices */}
      <ScrollTopButton bottomClass="bottom-24" />
    </div>
  )
}

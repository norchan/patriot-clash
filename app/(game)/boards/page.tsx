import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import BoardsDeck from '@/components/BoardsDeck'
import ScrollTopButton from '@/components/ScrollTopButton'
import { BoardsLeftNav, BoardsProfileCard } from '@/components/BoardsSidebars'

// /boards — the boards deck full-page. Mobile: the deck alone (game ☰ rides
// below the tab strip). DESKTOP (lg+): Twitter-style three columns — the game
// menu as a static LEFT sidebar (the floating ☰ hides here), the feed center,
// and the player's profile card on the RIGHT (Michael).

export default async function BoardsPage() {
  const { userId } = await auth()
  const admin = createSupabaseAdminClient()

  let profile: { id: string; username: string; party: string | null; avatar_url: string | null; fp_balance: number; total_battles_won: number } | null = null
  let subTabs: string[] = []
  if (userId) {
    const { data: prof } = await admin.from('profiles')
      .select('id, username, party, avatar_url, fp_balance, total_battles_won')
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
    .select('id, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at, party, profiles!hall_posts_profile_id_fkey(username, avatar_url), gyms!hall_posts_gym_id_fkey(city_name, state)')
    .eq('hidden', false)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)

  const deckPosts = (posts ?? []).map((p: any) => ({
    id: p.id, content: p.content, image_url: p.image_url,
    link_title: p.link_title, link_domain: p.link_domain,
    link_url: p.link_url, link_image: p.link_image,
    score: p.score, comment_count: p.comment_count, created_at: p.created_at,
    party: p.party, username: p.profiles?.username ?? 'Player',
    avatar_url: p.profiles?.avatar_url ?? null,
    city: p.gyms?.city_name ?? null, state: p.gyms?.state ?? null,
  }))

  return (
    // the game shell relaxes its phone width on lg for this page (see
    // layout.tsx) — the three columns center themselves in the open space
    <div className="min-h-screen bg-gray-950">
      <div className="mx-auto flex justify-center gap-6 lg:px-6">
        {/* LEFT (desktop): the game menu as a column — the floating ☰ hides on lg */}
        <aside className="hidden lg:block w-56 shrink-0 pt-6 sticky top-6 self-start">
          <BoardsLeftNav signedIn={!!profile} />
        </aside>

        {/* the feed — Top pill rides the column's own right edge */}
        <div className="w-full max-w-2xl min-w-0">
          <BoardsDeck signedIn={!!profile} initialPosts={deckPosts} extraTabs={subTabs} swipeNav tall />
          <ScrollTopButton bottomClass="bottom-24" />
        </div>

        {/* RIGHT (desktop): the player card, Twitter-style */}
        <aside className="hidden lg:block w-72 shrink-0 pt-6 sticky top-6 self-start">
          <BoardsProfileCard profile={profile ? { username: profile.username, party: profile.party, avatar_url: profile.avatar_url, fp_balance: profile.fp_balance, total_battles_won: profile.total_battles_won } : null} />
        </aside>
      </div>
    </div>
  )
}

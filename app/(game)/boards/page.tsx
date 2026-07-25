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
      {/* Rails PIN while the feed scrolls (Michael): the game shell's
          overflow-y main makes CSS sticky a no-op here, so the rail content
          is FIXED, positioned off the centered 1232px row (224+24+672+24+288)
          — spacers keep the feed centered. xl+ so the math always fits. */}
      <div className="mx-auto flex justify-center gap-6 xl:px-6">
        <aside className="hidden xl:block w-56 shrink-0">
          <div className="fixed w-56" style={{ top: '1.5rem', left: 'calc(50vw - 38.5rem)' }}>
            <BoardsLeftNav signedIn={!!profile} />
          </div>
        </aside>

        {/* the feed — Top pill rides the column's own right edge */}
        <div className="w-full max-w-2xl min-w-0">
          <BoardsDeck signedIn={!!profile} initialPosts={deckPosts} extraTabs={subTabs} swipeNav tall />
          <ScrollTopButton bottomClass="bottom-24" />
        </div>

        <aside className="hidden xl:block w-72 shrink-0">
          <div className="fixed w-72" style={{ top: '1.5rem', left: 'calc(50vw + 20.5rem)' }}>
            <BoardsProfileCard profile={profile ? { username: profile.username, party: profile.party, avatar_url: profile.avatar_url, fp_balance: profile.fp_balance, total_battles_won: profile.total_battles_won } : null} />
          </div>
        </aside>
      </div>
    </div>
  )
}

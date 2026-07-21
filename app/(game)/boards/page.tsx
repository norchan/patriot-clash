import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import BoardsDeck from '@/components/BoardsDeck'

// /boards — the boards deck full-page: same ☰ menu and psub tab strip as
// the homepage, landing on p/all, no map, no icons, no title. Swiping the
// feed left/right moves between psubs (the tab strip itself just scrolls).

export default async function BoardsPage() {
  const { userId } = await auth()
  const admin = createSupabaseAdminClient()

  let profileId: string | null = null
  let subTabs: string[] = []
  if (userId) {
    const { data: prof } = await admin.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle()
    profileId = prof?.id ?? null
    if (profileId) {
      const { data: subs } = await admin.from('board_subscriptions')
        .select('boards(slug)')
        .eq('profile_id', profileId)
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
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-2xl mx-auto">
        <BoardsDeck signedIn={!!profileId} initialPosts={deckPosts} extraTabs={subTabs} swipeNav tall />
      </div>
    </div>
  )
}

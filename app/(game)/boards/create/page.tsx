import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import CreatePost from '@/components/CreatePost'

// /boards/create — the full composer (Michael): title + body + pSub picker +
// link with preview autofill. Every postable board is offered (locals are
// posted at their town hall, so they're excluded — same rule as the API).

export default async function CreatePostPage() {
  const { userId } = await auth()
  if (!userId) redirect(`/sign-up?redirect_url=${encodeURIComponent('/boards/create')}`)
  const admin = createSupabaseAdminClient()

  const { data: prof } = await admin.from('profiles')
    .select('id').eq('clerk_user_id', userId).maybeSingle()
  if (!prof) redirect('/onboarding')

  // postable boards: everything but the per-hall locals (~190 rows)
  const boards: { slug: string; name: string; category: string }[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await admin.from('boards')
      .select('slug, name, category')
      .neq('category', 'local')
      .order('category').order('slug')
      .range(off, off + 999)
    boards.push(...((data as any) ?? []))
    if (!data || data.length < 1000) break
  }
  // featured topics first, then the rest alphabetically-by-category
  const featured = ['politics', 'news', 'videos', 'sports', 'space', 'movies', 'ufos', 'random-facts']
  boards.sort((a, b) => {
    const fa = featured.indexOf(a.slug), fb = featured.indexOf(b.slug)
    if (fa !== -1 || fb !== -1) return (fa === -1 ? 99 : fa) - (fb === -1 ? 99 : fb)
    return a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug)
  })

  return <CreatePost boards={boards} defaultSlug="politics" />
}

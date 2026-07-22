import Link from 'next/link'
import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import SubscribeButton from '@/components/SubscribeButton'
import PsubNav from '@/components/PsubNav'

// THE PSUB DIRECTORY — featured (+ your subscriptions pinned on top), local
// search, states (open), sports leagues (collapsible, closed by default),
// community. Subscribing adds a psub to the homepage boards deck tabs.

export const metadata: Metadata = {
  title: 'All psubs — the PoliticsGo boards',
  description: 'Every PoliticsGo post board: politics, sports teams, all 50 states, and a local board for every real American town hall.',
  alternates: { canonical: 'https://politicsgo.app/p' },
}

const FEATURED = [
  { slug: 'all', label: 'p/all', sub: 'everything, everywhere' },
  { slug: 'videos', label: 'p/videos', sub: 'clips worth passing on' },
  { slug: 'politics', label: 'p/politics', sub: 'the national argument' },
  { slug: 'democrats', label: 'p/democrats', sub: 'blue team posts' },
  { slug: 'republicans', label: 'p/republicans', sub: 'red team posts' },
  { slug: 'sports', label: 'p/sports', sub: 'all of it' },
  { slug: 'space', label: 'p/space', sub: 'up and out' },
  { slug: 'movies', label: 'p/movies', sub: 'what to watch' },
  { slug: 'funny', label: 'p/funny', sub: 'memes and mayhem' },
  { slug: 'news', label: 'p/news', sub: 'what just happened' },
]
const LEAGUES = [['nfl', '🏈 NFL'], ['nba', '🏀 NBA'], ['mlb', '⚾ MLB'], ['nhl', '🏒 NHL']] as const

function BoardRow({ slug, label, subscribed, signedIn }: {
  slug: string; label: string; subscribed: boolean; signedIn: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900 pl-3 pr-1.5 py-1.5 hover:border-purple-700 transition">
      <Link href={`/p/${slug}`} className="flex-1 min-w-0 truncate text-[13px] text-gray-300 hover:text-white">
        {label}
      </Link>
      <SubscribeButton slug={slug} initial={subscribed} signedIn={signedIn} />
    </div>
  )
}

export default async function BoardsDirectory({ searchParams }: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim()
  const admin = createSupabaseAdminClient()

  // who's asking — for subscription state on every row
  const { userId } = await auth()
  let profileId: string | null = null
  const subbed = new Set<string>()
  let mySubs: { slug: string; name: string }[] = []
  if (userId) {
    const { data: prof } = await admin.from('profiles').select('id').eq('clerk_user_id', userId).single()
    profileId = prof?.id ?? null
    if (profileId) {
      const { data: subs } = await admin.from('board_subscriptions')
        .select('boards(slug, name)')
        .eq('profile_id', profileId)
        .order('created_at')
      mySubs = (subs ?? []).map((s: any) => s.boards).filter(Boolean)
      for (const s of mySubs) subbed.add(s.slug)
    }
  }
  const signedIn = !!profileId

  const [{ data: sports }, { data: states }, { data: community }, localsRes, { count: localCount }] = await Promise.all([
    admin.from('boards').select('slug, name, subcategory').eq('category', 'sports').order('name'),
    admin.from('boards').select('slug, name, state').eq('category', 'state').order('name'),
    admin.from('boards').select('slug, name').eq('category', 'user').order('created_at', { ascending: false }).limit(40),
    query.length >= 2
      ? admin.from('boards').select('slug, name').eq('category', 'local').ilike('name', `%${query}%`).order('name').limit(50)
      : Promise.resolve({ data: [] as any[] }),
    admin.from('boards').select('id', { count: 'exact', head: true }).eq('category', 'local'),
  ])
  const locals = localsRes.data ?? []
  const featuredSlugs = new Set(FEATURED.map(f => f.slug))
  const pinned = mySubs.filter(s => !featuredSlugs.has(s.slug))

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-24">
      <PsubNav />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <nav className="text-sm text-gray-500 mb-4 flex items-center justify-between">
          <Link href="/" className="hover:text-white">← Home</Link>
          <Link href="/p/all" className="hover:text-white">p/all →</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">☰ All psubs</h1>
        <p className="text-gray-500 text-sm mt-1">
          {(2 + FEATURED.length + (sports?.length ?? 0) + (states?.length ?? 0) + (localCount ?? 0)).toLocaleString()} boards —
          every team, every state, every town hall. <b className="text-gray-400">+</b> subscribes: the psub joins your homepage tabs.
        </p>

        {/* Featured — subscriptions pin to the top */}
        <h2 className="mt-7 text-lg font-black text-white">⭐ Featured</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {pinned.map(s => (
            <div key={s.slug} className="relative rounded-xl border border-purple-700 bg-purple-950/30 px-3.5 py-3">
              <Link href={`/p/${s.slug}`} className="block">
                <p className="font-black text-white text-sm truncate">p/{s.slug}</p>
                <p className="text-purple-400 text-[11px] mt-0.5">★ subscribed</p>
              </Link>
              <div className="absolute top-2 right-2">
                <SubscribeButton slug={s.slug} initial signedIn={signedIn} />
              </div>
            </div>
          ))}
          {FEATURED.map(f => (
            <Link key={f.slug} href={`/p/${f.slug}`}
              className="rounded-xl border border-gray-800 bg-gray-900 px-3.5 py-3 hover:border-purple-700 transition">
              <p className="font-black text-white text-sm">{f.label}</p>
              <p className="text-gray-500 text-[11px] mt-0.5">{f.sub}</p>
            </Link>
          ))}
        </div>

        {/* Local — search first, the list is 2,350 deep */}
        <h2 className="mt-8 text-lg font-black text-white">🏛️ Local</h2>
        <p className="text-gray-500 text-xs mt-1">One board for every town hall ({(localCount ?? 0).toLocaleString()}). Search yours:</p>
        <form action="/p" className="mt-3 flex gap-2">
          <input name="q" defaultValue={query} placeholder="City name… (e.g. St. Peter)"
            className="flex-1 px-4 py-2.5 rounded-xl bg-gray-900 border border-gray-800 text-white text-sm placeholder-gray-600 outline-none focus:border-purple-600" />
          <button className="px-5 py-2.5 rounded-xl font-black text-white text-sm"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Search
          </button>
        </form>
        {query.length >= 2 && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {locals.map((l: any) => (
              <BoardRow key={l.slug} slug={l.slug} label={`p/${l.slug}`} subscribed={subbed.has(l.slug)} signedIn={signedIn} />
            ))}
            {locals.length === 0 && <p className="text-gray-600 text-sm col-span-full">No town matches “{query}”.</p>}
          </div>
        )}

        {/* States — always open */}
        <h2 className="mt-8 text-lg font-black text-white">🗺️ States</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {(states ?? []).map((s: any) => (
            <BoardRow key={s.slug} slug={s.slug} label={`p/${s.slug}`} subscribed={subbed.has(s.slug)} signedIn={signedIn} />
          ))}
        </div>

        {/* Sports — each league collapsible, closed by default */}
        <h2 className="mt-8 text-lg font-black text-white">🏆 Sports</h2>
        {LEAGUES.map(([lg, label]) => (
          <details key={lg} className="mt-3 rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden group">
            <summary className="cursor-pointer select-none px-4 py-3 font-black text-gray-200 text-sm flex items-center justify-between hover:bg-white/5">
              {label}
              <span className="text-gray-500 text-xs font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {(sports ?? []).filter((t: any) => t.subcategory === lg).map((t: any) => (
                <BoardRow key={t.slug} slug={t.slug} label={t.name} subscribed={subbed.has(t.slug)} signedIn={signedIn} />
              ))}
            </div>
          </details>
        ))}

        {/* Community */}
        <h2 className="mt-8 text-lg font-black text-white">👥 Community</h2>
        <p className="text-gray-500 text-xs mt-1">Player-created psubs — make yours from the boards menu on the homepage.</p>
        {(community ?? []).length > 0 && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(community ?? []).map((c: any) => (
              <BoardRow key={c.slug} slug={c.slug} label={`p/${c.slug}`} subscribed={subbed.has(c.slug)} signedIn={signedIn} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

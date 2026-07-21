import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// THE PSUB DIRECTORY — every board, by category: featured, politics, sports
// (by league), states, community (player-made), and a searchable index of
// all ~2,350 town-hall boards.

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

export default async function BoardsDirectory({ searchParams }: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim()
  const admin = createSupabaseAdminClient()

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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <nav className="text-sm text-gray-500 mb-4 flex items-center justify-between">
          <Link href="/" className="hover:text-white">← Home</Link>
          <Link href="/p/all" className="hover:text-white">p/all →</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">☰ All psubs</h1>
        <p className="text-gray-500 text-sm mt-1">
          {(2 + FEATURED.length + (sports?.length ?? 0) + (states?.length ?? 0) + (localCount ?? 0)).toLocaleString()} boards —
          every team, every state, every town hall.
        </p>

        {/* Featured */}
        <h2 className="mt-7 text-lg font-black text-white">⭐ Featured</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
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
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {locals.map((l: any) => (
              <Link key={l.slug} href={`/p/${l.slug}`}
                className="rounded-xl border border-gray-800 bg-gray-900 px-3.5 py-2.5 text-sm text-gray-300 hover:text-white hover:border-purple-700">
                p/{l.slug}
              </Link>
            ))}
            {locals.length === 0 && <p className="text-gray-600 text-sm col-span-full">No town matches “{query}”.</p>}
          </div>
        )}

        {/* States */}
        <h2 className="mt-8 text-lg font-black text-white">🗺️ States</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(states ?? []).map((s: any) => (
            <Link key={s.slug} href={`/p/${s.slug}`}
              className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-[13px] text-gray-300 hover:text-white hover:border-purple-700">
              p/{s.slug}
            </Link>
          ))}
        </div>

        {/* Sports by league */}
        <h2 className="mt-8 text-lg font-black text-white">🏆 Sports</h2>
        {LEAGUES.map(([lg, label]) => (
          <div key={lg} className="mt-4">
            <h3 className="font-black text-gray-300 text-sm">{label}</h3>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {(sports ?? []).filter((t: any) => t.subcategory === lg).map((t: any) => (
                <Link key={t.slug} href={`/p/${t.slug}`}
                  className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-[13px] text-gray-300 hover:text-white hover:border-purple-700">
                  {t.name}
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Community */}
        <h2 className="mt-8 text-lg font-black text-white">👥 Community</h2>
        <p className="text-gray-500 text-xs mt-1">Player-created psubs — make yours from the boards menu on the homepage.</p>
        {(community ?? []).length > 0 && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(community ?? []).map((c: any) => (
              <Link key={c.slug} href={`/p/${c.slug}`}
                className="rounded-xl border border-gray-800 bg-gray-900 px-3.5 py-2.5 text-sm text-gray-300 hover:text-white hover:border-purple-700">
                p/{c.slug}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

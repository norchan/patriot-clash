import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// PUBLIC, no-login, server-rendered page for a single town hall. One crawlable
// content page per hall (city name + live town-square posts) — strong for both
// AdSense review and organic search. Revalidates every 10 minutes.
export const revalidate = 600

// slug helpers: "St. Peter" + "MN"  <->  "st-peter-mn"
function slugify(city: string, state: string): string {
  return `${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function findHall(slug: string) {
  const admin = createSupabaseAdminClient()
  // The slug ends with the 2-letter state; the rest is the city.
  const m = /^(.*)-([a-z]{2})$/.exec(slug)
  if (!m) return null
  const state = m[2].toUpperCase()
  const cityGuess = m[1].replace(/-/g, ' ')
  const { data } = await admin
    .from('gyms')
    .select('id, city_name, state, county, population, holder_party')
    .eq('state', state)
    .ilike('city_name', cityGuess)
    .limit(1)
    .maybeSingle()
  if (data) return data
  // Fallback: match by rebuilding the slug (handles punctuation like "St.")
  const { data: rows } = await admin
    .from('gyms')
    .select('id, city_name, state, county, population, holder_party')
    .eq('state', state)
    .ilike('city_name', `${cityGuess.split(' ')[0]}%`)
    .limit(25)
  return (rows ?? []).find(r => slugify(r.city_name, r.state) === slug) ?? null
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params
  const hall = await findHall(city)
  if (!hall) return { title: 'Town hall — PoliticsGo' }
  const title = `${hall.city_name}, ${hall.state} town hall — PoliticsGo`
  const desc = `See the ${hall.city_name}, ${hall.state} town square on PoliticsGo: local headlines, hometown events, and the political battle for the ${hall.city_name} town hall. Free to play.`
  return {
    title,
    description: desc,
    alternates: { canonical: `https://politicsgo.app/explore/${city}` },
    openGraph: { title, description: desc },
  }
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default async function CityHallPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params
  const hall = await findHall(city)
  if (!hall) notFound()

  const admin = createSupabaseAdminClient()
  const [{ data: rawPosts }, { data: nearby }] = await Promise.all([
    admin.from('hall_posts')
      .select('content, link_title, link_domain, score, comment_count, created_at')
      .eq('gym_id', hall.id).eq('hidden', false)
      .order('created_at', { ascending: false }).limit(40),
    admin.from('gyms').select('city_name, state, population')
      .eq('state', hall.state).neq('id', hall.id)
      .order('population', { ascending: false }).limit(12),
  ])

  const posts = (rawPosts ?? [])
    .map(p => ({
      text: (p.content || p.link_title || '').trim(),
      source: p.link_domain as string | null,
      score: p.score as number,
      comments: p.comment_count as number,
      created_at: p.created_at as string,
    }))
    .filter(p => p.text)
    .slice(0, 30)

  const held = hall.holder_party === 'democrat' ? 'Democrats'
    : hall.holder_party === 'republican' ? 'Republicans' : null

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/explore" className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <span className="font-black tracking-tight text-lg">PoliticsGo</span>
          </Link>
          <Link href="/sign-up" className="font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5 text-sm">Play free</Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5">
        {/* Breadcrumb */}
        <nav className="text-sm text-gray-500 pt-5">
          <Link href="/explore" className="hover:text-gray-300">Explore</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-300">{hall.city_name}, {hall.state}</span>
        </nav>

        {/* Hall header */}
        <section className="pt-4 pb-6 border-b border-gray-800">
          <h1 className="text-3xl font-black">🏛️ {hall.city_name}, {hall.state} Town Hall</h1>
          <p className="text-gray-300 mt-3 leading-relaxed max-w-2xl">
            The {hall.city_name} town hall is a live landmark in PoliticsGo{hall.county ? `, in ${hall.county} County` : ''}.
            Players in {hall.city_name} pick a party, walk the neighborhood to earn Fighting Points, battle for control
            of the hall, and gather in its <strong className="text-white">town square</strong> to share local headlines
            and hometown events. {held ? `Right now it's held by the ${held}.` : 'It’s up for grabs right now.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/sign-up" className="font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl px-5 py-2.5">
              Play in {hall.city_name} — free
            </Link>
            <Link href="/explore" className="font-bold text-gray-200 bg-gray-800 hover:bg-gray-700 rounded-xl px-5 py-2.5">
              ← All town halls
            </Link>
          </div>
        </section>

        {/* Town square posts */}
        <section className="py-6">
          <h2 className="text-xl font-black mb-1">The {hall.city_name} town square</h2>
          <p className="text-gray-500 text-sm mb-4">
            {posts.length > 0
              ? `Recent posts players are sharing in the ${hall.city_name} hall.`
              : `No posts here yet — be the first to start the conversation in ${hall.city_name}.`}
          </p>
          <div className="space-y-3">
            {posts.map((p, i) => (
              <article key={i} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                <p className="text-gray-100 text-sm leading-relaxed">{p.text.slice(0, 280)}</p>
                <div className="text-gray-500 text-xs mt-2 flex flex-wrap gap-x-3">
                  <span>▲ {p.score}</span>
                  <span>💬 {p.comments}</span>
                  {p.source && <span>· {p.source}</span>}
                  <span>· {timeAgo(p.created_at)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Nearby halls — internal links for crawl depth */}
        {nearby && nearby.length > 0 && (
          <section className="py-6 border-t border-gray-800">
            <h2 className="text-lg font-black mb-3">More town halls in {hall.state}</h2>
            <div className="flex flex-wrap gap-2">
              {nearby.map(n => (
                <Link key={`${n.city_name}-${n.state}`} href={`/explore/${slugify(n.city_name, n.state)}`}
                  className="text-sm rounded-full border border-gray-800 bg-gray-900 px-3 py-1.5 text-gray-300 hover:bg-gray-800">
                  🏛️ {n.city_name}, {n.state}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="py-10 border-t border-gray-800 text-center">
          <h2 className="text-2xl font-black">Fight for {hall.city_name}.</h2>
          <p className="text-gray-400 mt-2">Free to play. Nothing to download — it runs in your browser.</p>
          <Link href="/sign-up" className="inline-block mt-5 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl px-6 py-3">
            Play PoliticsGo free
          </Link>
        </section>
      </div>

      <footer className="border-t border-gray-800">
        <div className="max-w-4xl mx-auto px-5 py-6 text-sm text-gray-500 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>© {new Date().getFullYear()} PoliticsGo</span>
          <div className="flex gap-5">
            <Link href="/explore" className="hover:text-gray-300">Explore</Link>
            <Link href="/welcome" className="hover:text-gray-300">Live map</Link>
            <Link href="/sign-up" className="hover:text-gray-300">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

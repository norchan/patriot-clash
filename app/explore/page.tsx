import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// PUBLIC, no-login, server-rendered content page. Gives search engines and
// the AdSense reviewer real, crawlable content (town halls, live town-square
// posts) instead of only the login wall. Revalidates every 5 minutes.
export const revalidate = 300

function slugify(city: string, state: string): string {
  return `${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const metadata: Metadata = {
  title: 'Explore PoliticsGo — town halls & town squares across America',
  description:
    'PoliticsGo is a location-based game where you pick a party, walk your real neighborhood, capture town halls, and debate in local town squares. Browse town halls and the latest local conversations across the country.',
  alternates: { canonical: 'https://politicsgo.app/explore' },
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default async function ExplorePage() {
  const admin = createSupabaseAdminClient()

  const [{ data: gyms }, { data: rawPosts }] = await Promise.all([
    admin.from('gyms').select('id, city_name, state, holder_party, population')
      .order('population', { ascending: false }).limit(150),
    admin.from('hall_posts').select('content, link_title, link_domain, gym_id, created_at')
      .eq('hidden', false).order('created_at', { ascending: false }).limit(80),
  ])

  const gymById = Object.fromEntries((gyms ?? []).map(g => [g.id, g]))
  const posts = (rawPosts ?? [])
    .map(p => ({
      text: (p.content || p.link_title || '').trim(),
      source: p.link_domain as string | null,
      city: gymById[p.gym_id]?.city_name as string | undefined,
      state: gymById[p.gym_id]?.state as string | undefined,
      created_at: p.created_at as string,
    }))
    .filter(p => p.text && p.city)
    .slice(0, 40)

  const halls = (gyms ?? []).filter(g => g.city_name)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <span className="font-black tracking-tight text-lg">PoliticsGo</span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/welcome" className="text-gray-400 hover:text-white">About</Link>
            <Link href="/sign-up" className="font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5">Play free</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-5 pt-12 pb-8">
        <h1 className="text-3xl sm:text-4xl font-black leading-tight">
          Walk your city. Capture town halls. Win the argument.
        </h1>
        {/* the public directory — one card per section, no guessing */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: '/battlemap', emoji: '🗺️', title: 'Battle Map', sub: 'The live national map war' },
            { href: '/explore/scoreboard', emoji: '🏆', title: 'Scoreboard', sub: 'Who controls each state' },
            { href: '/p/all', emoji: '📰', title: 'p/ boards', sub: 'The public post board' },
            { href: '/explore/leaderboards', emoji: '🥇', title: 'Leaderboards', sub: 'Arcade & arena champs' },
            { href: '/explore/characters', emoji: '🎭', title: 'Characters', sub: 'The full satirical roster' },
            { href: '/explore/guide', emoji: '📖', title: 'How to Play', sub: 'The complete guide' },
            { href: '/explore/news', emoji: '🗞️', title: 'News', sub: 'Updates from the devs' },
            { href: '/explore/faq', emoji: '❓', title: 'FAQ & About', sub: 'Answers + who we are' },
          ].map(c => (
            <Link key={c.href} href={c.href}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-purple-700 transition">
              <div className="text-2xl">{c.emoji}</div>
              <div className="font-bold text-white text-sm mt-1">{c.title}</div>
              <div className="text-gray-500 text-xs mt-0.5">{c.sub}</div>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-gray-300 max-w-2xl leading-relaxed">
          PoliticsGo is a free, location-based game for the United States. Pick a party — Democrat
          or Republican — and explore the real world on a live map. Every real town hall is a
          landmark you can visit, battle for, and hold for your side. Each one has a
          <strong className="text-white"> town square</strong>: a local feed where players share
          headlines, hometown events, and hot takes, and argue it out with upvotes and replies.
          Walking earns Fighting Points (FP) you spend on battles, captures, and the arcade.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/sign-up" className="font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl px-5 py-3">
            Start playing — it's free
          </Link>
          <Link href="/welcome" className="font-bold text-gray-200 bg-gray-800 hover:bg-gray-700 rounded-xl px-5 py-3">
            See the live map
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-5 py-8 border-t border-gray-800">
        <h2 className="text-xl font-black mb-4">How PoliticsGo works</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { e: '🧭', t: 'Pick your party', d: 'Choose Democrat or Republican, then head out into your real neighborhood on the map.' },
            { e: '🚶', t: 'Walk to earn FP', d: 'Your steps become Fighting Points. Spend them on battles, character captures, and the arcade.' },
            { e: '🏛️', t: 'Capture town halls', d: 'Challenge and hold real town halls for your party. Cliques defend their hometown hall together.' },
            { e: '💬', t: 'Win the town square', d: 'Every hall has a local feed — post headlines and local events, and out-argue the other side.' },
          ].map(c => (
            <div key={c.t} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="text-2xl">{c.e}</div>
              <div className="font-bold mt-2">{c.t}</div>
              <p className="text-gray-400 text-sm mt-1 leading-relaxed">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Latest from the town squares */}
      {posts.length > 0 && (
        <section className="max-w-5xl mx-auto px-5 py-8 border-t border-gray-800">
          <h2 className="text-xl font-black mb-1">Latest from the town squares</h2>
          <p className="text-gray-500 text-sm mb-4">Recent posts players are sharing in local halls across the country.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {posts.map((p, i) => (
              <article key={i} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                <p className="text-gray-100 text-sm leading-relaxed">{p.text.slice(0, 240)}</p>
                <div className="text-gray-500 text-xs mt-2">
                  📍 {p.city}, {p.state}{p.source ? ` · ${p.source}` : ''} · {timeAgo(p.created_at)}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Town halls directory */}
      {halls.length > 0 && (
        <section className="max-w-5xl mx-auto px-5 py-8 border-t border-gray-800">
          <h2 className="text-xl font-black mb-1">Town halls across America</h2>
          <p className="text-gray-500 text-sm mb-4">
            {halls.length}+ real town halls are in play right now. Sign up to visit the ones near you.
          </p>
          <div className="flex flex-wrap gap-2">
            {halls.map(g => (
              <Link key={g.id} href={`/explore/${slugify(g.city_name, g.state)}`}
                className="text-sm rounded-full border border-gray-800 bg-gray-900 px-3 py-1.5 text-gray-300 hover:bg-gray-800 hover:text-white transition">
                🏛️ {g.city_name}, {g.state}
                {g.holder_party && (
                  <span className={g.holder_party === 'democrat' ? 'text-blue-400' : 'text-red-400'}>
                    {' '}· held by {g.holder_party === 'democrat' ? 'Democrats' : 'Republicans'}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA / footer */}
      <section className="max-w-5xl mx-auto px-5 py-12 border-t border-gray-800 text-center">
        <h2 className="text-2xl font-black">Your hometown hall is waiting.</h2>
        <p className="text-gray-400 mt-2">Free to play. Nothing to download — it runs right in your browser.</p>
        <Link href="/sign-up" className="inline-block mt-5 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl px-6 py-3">
          Play PoliticsGo free
        </Link>
      </section>

      <footer className="border-t border-gray-800">
        <div className="max-w-5xl mx-auto px-5 py-6 text-sm text-gray-500 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>© {new Date().getFullYear()} PoliticsGo</span>
          <div className="flex gap-5">
            <Link href="/explore" className="hover:text-gray-300">Explore</Link>
            <Link href="/welcome" className="hover:text-gray-300">Live map</Link>
            <Link href="/privacy" className="hover:text-gray-300">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-300">Terms</Link>
            <Link href="/sign-up" className="hover:text-gray-300">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

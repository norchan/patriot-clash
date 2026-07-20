import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// P/ BOARDS — the public post board. Reddit-style windows over the live town
// square feeds: p/all (everything), p/democrats, p/republicans, p/<state>.
// Readable by ANYONE, no login; posting happens inside the game's halls.
export const revalidate = 120

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'Washington D.C.', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
const NAME_TO_CODE = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase().replace(/[^a-z]/g, ''), code]))

function resolveBoard(raw: string): { kind: 'all' | 'party' | 'state'; key: string; label: string } | null {
  const b = decodeURIComponent(raw).toLowerCase().replace(/[^a-z]/g, '')
  if (b === 'all') return { kind: 'all', key: 'all', label: 'p/All' }
  if (b === 'democrats' || b === 'democrat' || b === 'dems') return { kind: 'party', key: 'democrat', label: 'p/Democrats' }
  if (b === 'republicans' || b === 'republican' || b === 'reps') return { kind: 'party', key: 'republican', label: 'p/Republicans' }
  const code = b.length === 2 ? b.toUpperCase() : NAME_TO_CODE[b]
  if (code && STATE_NAMES[code]) return { kind: 'state', key: code, label: `p/${STATE_NAMES[code].replace(/ /g, '')}` }
  return null
}

export async function generateMetadata({ params }: { params: Promise<{ board: string }> }): Promise<Metadata> {
  const { board } = await params
  const b = resolveBoard(board)
  if (!b) return {}
  return {
    title: `${b.label} — the PoliticsGo post board`,
    description: `Live posts from PoliticsGo town squares — ${b.label}. What America's town halls are arguing about right now.`,
    alternates: { canonical: `https://politicsgo.app/p/${board.toLowerCase()}` },
  }
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default async function BoardPage({ params, searchParams }: {
  params: Promise<{ board: string }>
  searchParams: Promise<{ sort?: string }>
}) {
  const { board } = await params
  const { sort } = await searchParams
  const b = resolveBoard(board)
  if (!b) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-black text-white">That board doesn&apos;t exist</p>
          <Link href="/p/all" className="text-purple-400 hover:text-purple-300 mt-2 inline-block">→ p/All</Link>
        </div>
      </div>
    )
  }
  const admin = createSupabaseAdminClient()
  const newest = sort === 'new'

  let q = admin.from('hall_posts')
    .select('id, gym_id, content, image_url, link_title, link_domain, score, comment_count, created_at, party, profiles(username), gyms(city_name, state)')
    .eq('hidden', false)
  if (b.kind === 'party') q = q.eq('party', b.key)
  if (b.kind === 'state') q = q.eq('gyms.state', b.key)
  const { data: posts } = await (b.kind === 'state'
    ? q.not('gyms', 'is', null).order(newest ? 'created_at' : 'score', { ascending: false }).limit(60)
    : q.order(newest ? 'created_at' : 'score', { ascending: false }).limit(60))

  const boards = ['All', 'Democrats', 'Republicans', 'Minnesota', 'Wisconsin', 'Texas', 'California', 'Florida', 'NewYork', 'Ohio']

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <nav className="text-sm text-gray-500 mb-4 flex items-center justify-between">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
          <span className="text-gray-600 text-xs">posts live for 48 hours</span>
        </nav>
        <h1 className="text-3xl font-black text-white">📰 {b.label}</h1>
        <p className="text-gray-500 text-sm mt-1">The public post board — live from PoliticsGo&apos;s town squares.</p>

        {/* board switcher */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {boards.map(name => (
            <Link key={name} href={`/p/${name.toLowerCase()}`}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black border ${
                b.label === `p/${name}` ? 'bg-purple-700 border-purple-500 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'}`}>
              p/{name}
            </Link>
          ))}
        </div>
        {/* sort */}
        <div className="mt-3 flex gap-2 text-xs font-bold">
          <Link href={`/p/${board}`} className={!newest ? 'text-white' : 'text-gray-500 hover:text-gray-300'}>🔥 Top</Link>
          <Link href={`/p/${board}?sort=new`} className={newest ? 'text-white' : 'text-gray-500 hover:text-gray-300'}>🕐 New</Link>
        </div>

        <div className="mt-4 space-y-3">
          {(posts ?? []).length === 0 && (
            <p className="text-gray-600 text-sm text-center py-10">Quiet board right now — check back soon.</p>
          )}
          {(posts ?? []).map((p: any) => (
            <article key={p.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {p.party && (
                  <span className="font-black" style={{ color: p.party === 'democrat' ? '#60a5fa' : '#f87171' }}>
                    {p.party === 'democrat' ? 'DEM' : 'REP'}
                  </span>
                )}
                <span className="font-bold text-gray-400">{p.profiles?.username ?? 'Player'}</span>
                {p.gyms && <span>· {p.gyms.city_name}, {p.gyms.state}</span>}
                <span>· {timeAgo(p.created_at)}</span>
              </div>
              <p className="mt-2 text-gray-200 text-sm whitespace-pre-wrap break-words">{p.content}</p>
              {p.link_title && (
                <div className="mt-2 text-xs text-gray-500 border border-gray-800 rounded-lg px-3 py-2">
                  🔗 {p.link_title} <span className="text-gray-600">({p.link_domain})</span>
                </div>
              )}
              {p.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" className="mt-2 rounded-xl max-h-80 object-cover" loading="lazy" />
              )}
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 font-bold">
                <span>▲ {p.score}</span>
                <span>💬 {p.comment_count}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-purple-800 bg-purple-950/30 p-5 text-center">
          <p className="text-gray-300 text-sm">Want to post? Every town hall in the game has a live town square.</p>
          <Link href="/" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Join the argument
          </Link>
        </div>
      </div>
    </div>
  )
}

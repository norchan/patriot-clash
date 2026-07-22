import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolvePBoard, fetchBoardPosts, FEATURED_TABS } from '@/lib/boards'
import BoardComposer from '@/components/BoardComposer'
import PsubNav from '@/components/PsubNav'
import BoardBanner from '@/components/BoardBanner'
import { videoEmbed } from '@/lib/video-embed'

// P/ BOARDS (psubs) — the public post boards. p/all + party windows, topic
// boards (videos, space...), team boards, state boards, one local board per
// town hall, and player-created psubs. Readable by ANYONE, no login.
export const revalidate = 120

export async function generateMetadata({ params }: { params: Promise<{ board: string }> }): Promise<Metadata> {
  const { board } = await params
  const admin = createSupabaseAdminClient()
  const b = await resolvePBoard(admin, board)
  if (!b) return {}
  // Empty boards stay OUT of the search index — 2,000+ thin near-blank pages
  // read as "low value content" to crawlers (the AdSense rejection reason).
  // The page itself stays public; it just isn't offered to Google until it
  // has something on it.
  let noindex = false
  if (b.kind === 'board') {
    const q = admin.from('hall_posts').select('id', { count: 'exact', head: true }).eq('hidden', false)
    const { count } = b.board.category === 'local' && b.board.gym_id
      ? await q.eq('gym_id', b.board.gym_id)
      : await q.eq('board_id', b.board.id)
    noindex = (count ?? 0) === 0
  }
  return {
    title: `${b.label} — the PoliticsGo post board`,
    description: `Live posts on ${b.label} — the PoliticsGo boards. What America is arguing about right now.`,
    alternates: { canonical: `https://politicsgo.app/p/${board.toLowerCase()}` },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
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
  const admin = createSupabaseAdminClient()
  const b = await resolvePBoard(admin, board)
  if (!b) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-black text-white">That psub doesn&apos;t exist</p>
          <p className="text-gray-500 text-sm mt-2">Want it to? Create it from the boards menu.</p>
          <Link href="/p/all" className="text-purple-400 hover:text-purple-300 mt-3 inline-block font-bold">→ p/all</Link>
        </div>
      </div>
    )
  }

  const newest = sort === 'new'
  const posts = await fetchBoardPosts(admin, b, newest ? 'new' : 'top', 60)
  const dbBoard = b.kind === 'board' ? b.board : null
  const isLocal = dbBoard?.category === 'local'
  const postable = !!dbBoard && !isLocal

  const sub = dbBoard?.category === 'sports' && dbBoard.subcategory
    ? dbBoard.subcategory.toUpperCase()
    : dbBoard?.category === 'state' ? 'Statewide'
    : dbBoard?.category === 'local' ? 'Town hall'
    : dbBoard?.category === 'user' ? 'Community psub' : null

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-24">
      <PsubNav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <nav className="text-sm text-gray-500 mb-4 flex items-center justify-between">
          <Link href="/" className="hover:text-white">← Home</Link>
          <span className="text-gray-600 text-xs">posts live for 48 hours</span>
        </nav>
        {/* the psub's BANNER — flag for states/locals, club colors for teams,
            gloves logo for p/all (Michael: banners instead of 📰 + name) */}
        <BoardBanner
          label={b.label}
          slug={dbBoard?.slug ?? b.label.slice(2)}
          category={b.kind === 'board' ? dbBoard!.category : b.kind === 'party' ? b.key + 's' : 'all'}
          subcategory={dbBoard?.subcategory}
          state={dbBoard?.state}
          name={dbBoard?.name}
        />
        <p className="text-gray-500 text-sm mt-2">
          {sub ? `${sub} · ` : ''}The public post board — live from PoliticsGo.
        </p>

        {/* featured tab strip + the full directory */}
        <div className="mt-4 -mx-4 px-4 flex gap-1.5 overflow-x-auto pb-2"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          <Link href="/p"
            className="shrink-0 px-3.5 py-2 rounded-full text-xs font-black border bg-gray-900 border-gray-700 text-gray-300 hover:text-white">
            ☰ all psubs
          </Link>
          {FEATURED_TABS.map(name => {
            const active = b.label === `p/${name}`
            return (
              <Link key={name} href={`/p/${name}`}
                className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-black border transition ${
                  active ? 'bg-purple-700 border-purple-400 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:border-gray-600'}`}>
                p/{name}
              </Link>
            )
          })}
        </div>
        {/* sort */}
        <div className="mt-3 flex gap-2 text-xs font-bold">
          <Link href={`/p/${board}`} className={!newest ? 'text-white' : 'text-gray-500 hover:text-gray-300'}>🔥 Top</Link>
          <Link href={`/p/${board}?sort=new`} className={newest ? 'text-white' : 'text-gray-500 hover:text-gray-300'}>🕐 New</Link>
        </div>

        {postable && <BoardComposer slug={dbBoard!.slug} />}
        {isLocal && dbBoard?.gym_id && (
          <Link href={`/townhall/${dbBoard.gym_id}`}
            className="mt-4 flex items-center justify-between rounded-2xl border border-purple-800 bg-purple-950/30 px-4 py-3 text-sm">
            <span className="text-gray-300">🏛️ This is {dbBoard.name}&apos;s town square</span>
            <span className="text-purple-400 font-black">Post at the hall →</span>
          </Link>
        )}

        <div className="mt-4 space-y-3">
          {(posts ?? []).length === 0 && (
            <p className="text-gray-600 text-sm text-center py-10">
              Nothing on this board right now{postable ? ' — be the first to post.' : ' — check back soon.'}
            </p>
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
              {/* p/videos: the video PLAYS right in the feed, reels-sized */}
              {(() => {
                const v = videoEmbed(p.link_url)
                if (!v) return null
                return (
                  <div className={`mt-2 rounded-2xl overflow-hidden border border-gray-800 bg-black ${v.vertical ? 'max-w-[300px] mx-auto' : ''}`}
                    style={{ aspectRatio: v.vertical ? '9 / 16' : '16 / 9' }}>
                    <iframe src={v.src} className="w-full h-full" loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen title="Video" />
                  </div>
                )
              })()}
              {p.link_title && !videoEmbed(p.link_url) && (
                <div className="mt-2 rounded-2xl border border-gray-800 overflow-hidden">
                  {p.link_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.link_image} alt="" loading="lazy" className="w-full max-h-52 object-cover" />
                  )}
                  <div className="px-3 py-2.5 text-xs">
                    <p className="text-gray-600 text-[11px]">🔗 {p.link_domain}</p>
                    <p className="text-gray-300 mt-0.5 leading-snug">{p.link_title}</p>
                  </div>
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
          <p className="text-gray-300 text-sm">Every town hall, every state, every team has a board.</p>
          <Link href="/p" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Browse all psubs
          </Link>
        </div>
      </div>
    </div>
  )
}

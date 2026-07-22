import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import ReplyBox from '@/components/ReplyBox'
import PostActions from '@/components/PostActions'
import PsubNav from '@/components/PsubNav'
import { videoEmbed } from '@/lib/video-embed'

// PUBLIC POST PAGE — one post opened X-style: big text, media, link preview,
// stats, then the reply thread. Anyone can read; replying takes an account.
export const revalidate = 60

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const partyColor = (p: string | null) =>
  p === 'democrat' ? '#2563eb' : p === 'republican' ? '#dc2626' : '#6b7280'

function Avatar({ url, name, party, size = 44 }: { url: string | null; name: string; party: string | null; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="rounded-full object-cover shrink-0 border-2"
      style={{ width: size, height: size, borderColor: partyColor(party) }} />
  ) : (
    <div className="rounded-full shrink-0 flex items-center justify-center font-black text-white"
      style={{ width: size, height: size, background: partyColor(party), fontSize: size * 0.4 }}>
      {name[0]?.toUpperCase() ?? 'P'}
    </div>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ postId: string }> }): Promise<Metadata> {
  const { postId } = await params
  const admin = createSupabaseAdminClient()
  const { data: p } = await admin.from('hall_posts')
    .select('content, link_title').eq('id', postId).maybeSingle()
  const text = (p?.content ?? p?.link_title ?? 'A post').slice(0, 120)
  return { title: `${text} — PoliticsGo`, description: 'A post from the PoliticsGo boards.' }
}

export default async function PublicPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const admin = createSupabaseAdminClient()

  const { data: post } = await admin.from('hall_posts')
    .select('id, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at, party, hidden, profiles!hall_posts_profile_id_fkey(username, avatar_url), gyms!hall_posts_gym_id_fkey(id, city_name, state), boards(slug, name)')
    .eq('id', postId)
    .maybeSingle()

  if (!post || (post as any).hidden) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-black text-white">This post is gone</p>
          <p className="text-gray-500 text-sm mt-1">Posts live for 48 hours.</p>
          <Link href="/" className="text-purple-400 hover:text-purple-300 mt-3 inline-block font-bold">← Battle Map</Link>
        </div>
      </div>
    )
  }
  const p: any = post

  const { data: comments } = await admin.from('hall_comments')
    .select('id, parent_id, content, score, created_at, profiles!hall_comments_profile_id_fkey(username, avatar_url, party)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(200)

  const origin = p.gyms ? `${p.gyms.city_name}, ${p.gyms.state}` : p.boards ? `p/${p.boards.slug}` : null
  const originHref = p.gyms
    ? `/p/${`${p.gyms.city_name}-${p.gyms.state}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    : p.boards ? `/p/${p.boards.slug}` : '/p/all'

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-24">
      <PsubNav />
      <div className="max-w-xl mx-auto px-4 py-6">
        <nav className="text-sm text-gray-500 mb-4 flex items-center justify-between">
          <Link href="/" className="hover:text-white">← Battle Map</Link>
          {origin && <Link href={originHref} className="text-purple-400 hover:text-purple-300 font-bold">{origin}</Link>}
        </nav>

        {/* the post, X-style */}
        <article className="border-b border-gray-800 pb-4">
          <div className="flex items-center gap-3">
            <Avatar url={p.profiles?.avatar_url ?? null} name={p.profiles?.username ?? 'P'} party={p.party} />
            <div className="min-w-0">
              <p className="font-bold text-white truncate">{p.profiles?.username ?? 'Player'}</p>
              <p className="text-gray-500 text-xs">{origin ? `${origin} · ` : ''}{timeAgo(p.created_at)} ago</p>
            </div>
          </div>
          {p.content && (
            <p className="mt-3 text-[19px] text-gray-100 leading-snug whitespace-pre-wrap break-words">{p.content}</p>
          )}
          {p.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt="" className="mt-3 w-full rounded-2xl border border-gray-800 max-h-[520px] object-contain bg-black/40" />
          )}
          {/* video links play RIGHT HERE via the platform's official player */}
          {(() => {
            const v = videoEmbed(p.link_url)
            if (!v) return null
            return (
              <div className={`mt-3 rounded-2xl overflow-hidden border border-gray-800 bg-black ${v.vertical ? 'max-w-[320px] mx-auto' : ''}`}
                style={{ aspectRatio: v.vertical ? '9 / 16' : '16 / 9' }}>
                <iframe src={v.src} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen title="Video" />
              </div>
            )
          })()}
          {p.link_url && !videoEmbed(p.link_url) && (
            <a href={p.link_url} target="_blank" rel="noopener noreferrer"
              className="block mt-3 rounded-2xl border border-gray-800 overflow-hidden hover:border-gray-600 transition">
              {p.link_image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.link_image} alt="" className="w-full max-h-56 object-cover" />
              )}
              <div className="px-3.5 py-2.5">
                <p className="text-gray-200 text-sm leading-snug">{p.link_title ?? p.link_url}</p>
                <p className="text-gray-600 text-xs mt-0.5">🔗 {p.link_domain ?? new URL(p.link_url).hostname}</p>
              </div>
            </a>
          )}
          <div className="mt-2">
            <PostActions kind="post" id={p.id} postId={p.id} score={p.score} commentCount={p.comment_count} />
          </div>
        </article>

        <ReplyBox postId={p.id} />

        {/* replies */}
        <div className="divide-y divide-gray-800/70">
          {(comments ?? []).length === 0 && (
            <p className="text-gray-600 text-sm text-center py-10">No replies yet — say something.</p>
          )}
          {(comments ?? []).map((c: any) => (
            <div key={c.id} className={`py-3.5 flex gap-3 ${c.parent_id ? 'pl-10' : ''}`}>
              <Avatar url={c.profiles?.avatar_url ?? null} name={c.profiles?.username ?? 'P'} party={c.profiles?.party ?? null} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px]">
                  <span className="font-bold text-white truncate">{c.profiles?.username ?? 'Player'}</span>
                  <span className="text-gray-500">· {timeAgo(c.created_at)}</span>
                </div>
                <p className="mt-0.5 text-[14px] text-gray-200 leading-snug whitespace-pre-wrap break-words">{c.content}</p>
                <PostActions kind="comment" id={c.id} postId={p.id} score={c.score} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

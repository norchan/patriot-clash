import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolvePBoard, fetchBoardPosts } from '@/lib/boards'
import { videoEmbed } from '@/lib/video-embed'
import { rankReels } from '@/lib/reels-rank'
import { ReelsPager, type ReelItem } from '@/components/ReelsViewer'

// /reels — the fullscreen swipe-up video pager. PUBLIC, standalone page: the
// pager needs the document itself to scroll (see ReelsViewer.tsx), so it
// lives outside the game shell — no bottom nav, no layout chrome.
// Ordering (A1 Phase 4): rankReels v1 — recency + light score boost + party
// tilt for signed-in viewers; the client demotes already-watched clips.
// ?board=<slug> picks the feed (default p/videos), ?start=<postId> opens on
// that video in the server order.

export const metadata: Metadata = {
  title: 'Reels — PoliticsGo',
  description: 'Swipe the latest political video reels on PoliticsGo.',
  alternates: { canonical: 'https://politicsgo.app/reels' },
}

export default async function ReelsPage({ searchParams }: {
  searchParams: Promise<{ board?: string; start?: string }>
}) {
  const { board = 'videos', start } = await searchParams
  const admin = createSupabaseAdminClient()

  const { userId } = await auth()
  let party: string | null = null
  if (userId) {
    const { data } = await admin.from('profiles').select('party').eq('clerk_user_id', userId).maybeSingle()
    party = data?.party ?? null
  }

  const rb = await resolvePBoard(admin, board) ?? await resolvePBoard(admin, 'videos')
  const posts = rb ? await fetchBoardPosts(admin, rb, 'new', 80) : []
  const videoPosts = (posts ?? []).filter((q: any) => videoEmbed(q.link_url))
  const rankedPosts = rankReels(
    videoPosts.map((q: any) => ({ ...q, id: q.id, created_at: q.created_at, score: q.score, party: q.party })),
    { party },
  )
  const items: ReelItem[] = rankedPosts.flatMap((q: any) => {
    const v = videoEmbed(q.link_url)
    return v ? [{ id: q.id, kind: v.kind, videoId: v.id, vertical: v.vertical, thumb: v.thumb, title: q.link_title ?? q.content, username: q.profiles?.username, party: q.party }] : []
  })
  return <ReelsPager items={items} startId={start} signedIn={!!userId} />
}

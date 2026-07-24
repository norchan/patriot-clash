import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolvePBoard, fetchBoardPosts } from '@/lib/boards'
import { videoEmbed } from '@/lib/video-embed'
import { ReelsPager, type ReelItem } from '@/components/ReelsViewer'

// /reels — the fullscreen swipe-up video pager (Michael: tapping Reels should
// open fullscreen so people can start swiping). PUBLIC, standalone page: the
// pager needs the document itself to scroll (see ReelsViewer.tsx), so it
// lives outside the game shell — no bottom nav, no layout chrome.
// ?board=<slug> picks the feed (default p/videos), ?start=<postId> opens on
// that video.

export const revalidate = 60

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
  const rb = await resolvePBoard(admin, board) ?? await resolvePBoard(admin, 'videos')
  const posts = rb ? await fetchBoardPosts(admin, rb, 'new', 60) : []
  const items: ReelItem[] = (posts ?? []).flatMap((q: any) => {
    const v = videoEmbed(q.link_url)
    return v ? [{ id: q.id, kind: v.kind, videoId: v.id, vertical: v.vertical, thumb: v.thumb, title: q.link_title ?? q.content, username: q.profiles?.username }] : []
  })
  return <ReelsPager items={items} startId={start} />
}

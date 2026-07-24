import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { videoEmbed, videoAvailable } from '@/lib/video-embed'

// REELS SWEEP (Michael): once an hour, walk EVERY video post (p/videos and
// anywhere else a video link landed) and delete the ones whose video no
// longer plays — copyright takedowns, embed blocks, deletions. A dead
// "Video unavailable" frame in the swipe feed destroys trust faster than a
// missing post ever could. Replaces the capped 2-hourly sweep that used to
// ride inside board-engagement (200-post limit let blocked videos linger).
// videoAvailable is deliberately forgiving on network hiccups/bot-walls —
// only a confirmed-dead video gets deleted.

export const maxDuration = 300

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }))
  return results
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  // every live video post (48h expiry + margin), no row cap — paginate
  const posts: { id: string; link_url: string; link_title: string | null }[] = []
  for (let off = 0; ; off += 1000) {
    const { data: rows } = await admin.from('hall_posts')
      .select('id, link_url, link_title')
      .or('link_url.ilike.%youtube.com%,link_url.ilike.%youtu.be%,link_url.ilike.%tiktok.com%')
      .gte('created_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
      .order('id')
      .range(off, off + 999)
    posts.push(...(rows ?? []))
    if (!rows || rows.length < 1000) break
  }

  let checked = 0, removed = 0
  const removedTitles: string[] = []
  await mapLimit(posts, 6, async p => {
    if (!videoEmbed(p.link_url)) return
    checked++
    if (await videoAvailable(p.link_url)) return
    const { error } = await admin.from('hall_posts').delete().eq('id', p.id)
    if (!error) {
      removed++
      if (removedTitles.length < 20) removedTitles.push(p.link_title ?? p.link_url)
    }
  })

  return NextResponse.json({ ok: true, checked, removed, removed_titles: removedTitles })
}

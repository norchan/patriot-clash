import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Town Square content bot: pulls hot posts from r/Republican and
// r/democrats and has party-matched bot players share them into each
// town hall's thread as link posts (title + link + preview thumbnail,
// crediting the subreddit). Runs on a Vercel cron; callable manually
// with the same bearer secret.

export const maxDuration = 60

interface RedditPost {
  title: string
  permalink: string
  external_url: string | null
  image: string | null
  domain: string
  subreddit: string
}

async function fetchSubreddit(sub: string): Promise<RedditPost[]> {
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=40&raw_json=1`, {
      headers: { 'User-Agent': 'web:politicsgo.app:v1.0 (town square bot)' },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    const out: RedditPost[] = []
    for (const child of data?.data?.children ?? []) {
      const d = child?.data
      if (!d || d.stickied || d.over_18 || !d.title) continue
      const external = typeof d.url_overridden_by_dest === 'string' && /^https?:\/\//.test(d.url_overridden_by_dest)
        ? d.url_overridden_by_dest : null
      let image: string | null = d?.preview?.images?.[0]?.source?.url ?? null
      if (!image && typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http')) image = d.thumbnail
      out.push({
        title: String(d.title).slice(0, 300),
        permalink: `https://www.reddit.com${d.permalink}`,
        external_url: external && !external.includes('reddit.com') ? external : null,
        image,
        domain: external && !external.includes('reddit.com')
          ? (d.domain ?? new URL(external).hostname.replace(/^www\./, ''))
          : `reddit.com/r/${sub}`,
        subreddit: sub,
      })
    }
    return out
  } catch {
    return []
  }
}

const shuffle = <T,>(arr: T[]) => arr.map(v => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()

  const [repPosts, demPosts] = await Promise.all([
    fetchSubreddit('Republican'),
    fetchSubreddit('democrats'),
  ])
  if (repPosts.length === 0 && demPosts.length === 0) {
    return NextResponse.json({ error: 'Reddit returned nothing (possibly blocked)' }, { status: 502 })
  }

  const [{ data: bots }, { data: gyms }] = await Promise.all([
    admin.from('profiles').select('id, party').like('clerk_user_id', 'bot%'),
    admin.from('gyms').select('id'),
  ])
  const demBots = (bots ?? []).filter(b => b.party === 'democrat')
  const repBots = (bots ?? []).filter(b => b.party === 'republican')
  if (!gyms?.length || (!demBots.length && !repBots.length)) {
    return NextResponse.json({ error: 'No gyms or bots found' }, { status: 500 })
  }

  let inserted = 0
  for (const gym of gyms) {
    // What has already been shared here — never repost the same link
    const { data: existing } = await admin
      .from('hall_posts')
      .select('link_url')
      .eq('gym_id', gym.id)
      .not('link_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300)
    const seen = new Set((existing ?? []).map(e => e.link_url))

    // One fresh post per party per run, per hall
    const picks: { post: RedditPost; party: 'democrat' | 'republican' }[] = []
    const freshRep = shuffle(repPosts).find(p => !seen.has(p.external_url ?? p.permalink))
    const freshDem = shuffle(demPosts).find(p => !seen.has(p.external_url ?? p.permalink))
    if (freshRep && repBots.length) picks.push({ post: freshRep, party: 'republican' })
    if (freshDem && demBots.length) picks.push({ post: freshDem, party: 'democrat' })

    for (const { post, party } of picks) {
      const pool = party === 'democrat' ? demBots : repBots
      const bot = pool[Math.floor(Math.random() * pool.length)]
      const linkUrl = post.external_url ?? post.permalink
      // stagger timestamps over the past 8 hours so feeds look alive
      const createdAt = new Date(Date.now() - Math.random() * 8 * 3600 * 1000).toISOString()
      const { error } = await admin.from('hall_posts').insert({
        gym_id: gym.id,
        profile_id: bot.id,
        content: post.title,
        link_url: linkUrl,
        link_title: post.title,
        link_image: post.image,
        link_domain: post.domain,
        score: Math.floor(Math.random() * 12),
        created_at: createdAt,
      })
      if (!error) inserted++
    }
  }

  return NextResponse.json({
    ok: true,
    inserted,
    gyms: gyms.length,
    fetched: { republican: repPosts.length, democrat: demPosts.length },
  })
}

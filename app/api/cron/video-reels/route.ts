import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'
import { videoAvailable } from '@/lib/video-embed'

// P/VIDEOS REELS BOT (Michael, 2026-07-21): only SHORTS — vertical videos
// that fill the screen. Every run: pull recent uploads from big official
// channels' RSS feeds, keep only real Shorts (a /shorts/<id> URL answers 200
// for Shorts and redirects for regular videos), verify each is actually
// embeddable (videoAvailable — playability + playableInEmbed), skip anything
// already posted, and drop up to MAX_POSTS on the videos board.

export const maxDuration = 300

const MAX_POSTS = 2

const CHANNELS: [string, string][] = [
  ['NFL', 'UCDVYQ4Zhbm3S2dlz7P1GBDg'],
  ['NBA', 'UCWJ2lWNubArHWmf3FIHbfcQ'],
  ['MLB', 'UCoLrcjPV5PbUrUyXq5mjc_A'],
  ['NHL', 'UCqFMzb-4AUf6WAIbl132QKA'],
  ['NASA', 'UCLA_DiR1FfKNvjuUpBHmylQ'],
  ['House of Highlights', 'UCqQo7ewe87aYAe7ub5UqXMw'],
  ['ESPN', 'UCiWLfSweyRNmLpgEHekhoAg'],
  ['SportsCenter', 'UCrKucnER_1PdAw7Fc-4-nrA'],
  ['Dude Perfect', 'UCRijo3ddMTht_IHyNSNXpNQ'],
  ['Bleacher Report', 'UC9-OpMMVoNP5o10_Iyq7Ndw'],
]

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }

// the RSS endpoint intermittently 404s valid channels under load — retry once
async function fetchFeed(channelId: string): Promise<string | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: UA })
      if (r.ok) return await r.text()
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 800))
  }
  return null
}

async function isShort(id: string): Promise<boolean> {
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${id}`, { redirect: 'manual', headers: UA })
    return r.status === 200 // regular videos redirect to /watch
  } catch {
    return false
  }
}

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  const [{ data: board }, { data: bots }] = await Promise.all([
    admin.from('boards').select('id').eq('slug', 'videos').maybeSingle(),
    admin.from('profiles').select('id, party').like('clerk_user_id', 'bot%').limit(200),
  ])
  if (!board || !bots?.length) return NextResponse.json({ ok: false, error: 'no board/bots' })

  // everything already on the board — never repost a video
  const { data: existing } = await admin.from('hall_posts')
    .select('link_url')
    .eq('board_id', board.id)
    .not('link_url', 'is', null)
    .limit(1000)
  const posted = new Set(
    (existing ?? []).map(p => /(?:shorts\/|v=|youtu\.be\/)([\w-]{6,})/.exec(p.link_url ?? '')?.[1]).filter(Boolean)
  )

  let inserted = 0
  const errors: string[] = []
  for (const [channel, cid] of shuffle(CHANNELS)) {
    if (inserted >= MAX_POSTS) break
    const rss = await fetchFeed(cid)
    if (!rss) { errors.push(`${channel}: feed failed`); continue }
    const entries = [...rss.matchAll(/<entry>[\s\S]*?<yt:videoId>([\w-]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>/g)]
      .map(m => ({ id: m[1], title: m[2] }))

    for (const e of entries) {
      if (inserted >= MAX_POSTS) break
      if (posted.has(e.id)) continue
      if (!(await isShort(e.id))) continue
      const url = `https://www.youtube.com/shorts/${e.id}`
      if (!(await videoAvailable(url))) continue

      const caption = await openaiChat([
        { role: 'system', content: 'You write ONE short casual reaction (max 12 words) to share a video on a forum. Sound like a regular person hyped about a clip. No hashtags, no quotes around the reply, never mention being an AI.' },
        { role: 'user', content: `Video: ${e.title} (from ${channel})` },
      ], 40, 1.0)

      const bot = bots[Math.floor(Math.random() * bots.length)]
      const { error } = await admin.from('hall_posts').insert({
        board_id: board.id,
        profile_id: bot.id,
        party: bot.party ?? null,
        content: caption?.slice(0, 200) ?? e.title,
        link_url: url,
        link_title: e.title,
        link_domain: 'youtube.com',
        link_image: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
        score: 2 + Math.floor(Math.random() * 8),
      })
      if (!error) { inserted++; posted.add(e.id) }
      else errors.push(`${channel}: ${error.message}`)
      break // at most one per channel per run — keep the mix varied
    }
  }

  return NextResponse.json({ ok: true, inserted, errors })
}

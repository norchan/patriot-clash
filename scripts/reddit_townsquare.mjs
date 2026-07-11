// Town Square content bot (local runner). Reddit blocks Vercel's server
// IPs, so this fetches r/Republican + r/democrats from THIS machine and
// inserts link posts into every hall's thread as party-matched bots —
// identical behavior to /api/cron/reddit-posts.
//
// Usage: node scripts/reddit_townsquare.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function getRedditToken() {
  const id = env.REDDIT_CLIENT_ID, secret = env.REDDIT_CLIENT_SECRET
  if (!id || !secret) { console.error('Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env.local'); process.exit(1) }
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'web:politicsgo.app:v1.0 (town square bot)',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) { console.error(`token: HTTP ${res.status}`); process.exit(1) }
  return (await res.json()).access_token
}
const redditToken = await getRedditToken()

async function fetchSubreddit(sub) {
  const res = await fetch(`https://oauth.reddit.com/r/${sub}/hot?limit=40&raw_json=1`, {
    headers: { Authorization: `bearer ${redditToken}`, 'User-Agent': 'web:politicsgo.app:v1.0 (town square bot)' },
  })
  if (!res.ok) { console.error(`r/${sub}: HTTP ${res.status}`); return [] }
  const data = await res.json()
  const out = []
  for (const child of data?.data?.children ?? []) {
    const d = child?.data
    if (!d || d.stickied || d.over_18 || !d.title) continue
    const external = typeof d.url_overridden_by_dest === 'string' && /^https?:\/\//.test(d.url_overridden_by_dest)
      ? d.url_overridden_by_dest : null
    const ext = external && !external.includes('reddit.com') ? external : null
    let image = d?.preview?.images?.[0]?.source?.url ?? null
    if (!image && typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http')) image = d.thumbnail
    out.push({
      title: String(d.title).slice(0, 300),
      permalink: `https://www.reddit.com${d.permalink}`,
      external_url: ext,
      image,
      domain: ext ? (d.domain ?? new URL(ext).hostname.replace(/^www\./, '')) : `reddit.com/r/${sub}`,
    })
  }
  return out
}

const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v)

const [repPosts, demPosts] = await Promise.all([fetchSubreddit('Republican'), fetchSubreddit('democrats')])
console.log(`fetched: ${repPosts.length} republican, ${demPosts.length} democrat`)
if (!repPosts.length && !demPosts.length) process.exit(1)

const [{ data: bots }, { data: gyms }] = await Promise.all([
  sb.from('profiles').select('id, party').like('clerk_user_id', 'bot%'),
  sb.from('gyms').select('id'),
])
const demBots = (bots ?? []).filter(b => b.party === 'democrat')
const repBots = (bots ?? []).filter(b => b.party === 'republican')
console.log(`${gyms?.length ?? 0} gyms, ${demBots.length}+${repBots.length} bots`)

let inserted = 0
for (const gym of gyms ?? []) {
  const { data: existing } = await sb
    .from('hall_posts')
    .select('link_url')
    .eq('gym_id', gym.id)
    .not('link_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300)
  const seen = new Set((existing ?? []).map(e => e.link_url))

  const picks = []
  const freshRep = shuffle(repPosts).find(p => !seen.has(p.external_url ?? p.permalink))
  const freshDem = shuffle(demPosts).find(p => !seen.has(p.external_url ?? p.permalink))
  if (freshRep && repBots.length) picks.push({ post: freshRep, party: 'republican' })
  if (freshDem && demBots.length) picks.push({ post: freshDem, party: 'democrat' })

  for (const { post, party } of picks) {
    const pool = party === 'democrat' ? demBots : repBots
    const bot = pool[Math.floor(Math.random() * pool.length)]
    const { error } = await sb.from('hall_posts').insert({
      gym_id: gym.id,
      profile_id: bot.id,
      content: post.title,
      link_url: post.external_url ?? post.permalink,
      link_title: post.title,
      link_image: post.image,
      link_domain: post.domain,
      score: Math.floor(Math.random() * 12),
      created_at: new Date(Date.now() - Math.random() * 8 * 3600 * 1000).toISOString(),
    })
    if (error) console.error('insert failed:', error.message)
    else inserted++
  }
}
console.log(`inserted ${inserted} posts`)

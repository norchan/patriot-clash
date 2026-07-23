// ONE-TIME LOCAL SEED (Michael 2026-07-22): 10 unique posts in EVERY town
// hall, each about that specific city — something going on there, a local
// figure (generic role, never a named real person), or something to do with
// the town. 5 different bots per hall (2 posts each). Marked no_expire=true so
// the 48h bot-post sweep leaves them alone (permanent local flavor).
// Resumable: halls that already have no_expire seed posts are skipped.
// Uses OpenAI (gpt-4o-mini) — ONE call per hall returns all 10 varied posts.
// Usage: node scripts/seed_hall_posts.mjs
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const OPENAI_KEY = env.OPENAI_API_KEY

const POSTS_PER_HALL = 10
const BOTS_PER_HALL = 5
const CONCURRENCY = 10

const SYSTEM = `You write short, believable social-media posts from everyday residents of a specific US town, for a local community board.
Return EXACTLY 10 posts as a JSON array of 10 strings — nothing else.
Each post is about THIS town specifically. Mix these angles across the 10:
 - something happening in town (a local event, road work, the farmers market, weather, a festival, high school game, new shop opening)
 - a shout-out or gripe about a LOCAL FIGURE BY ROLE ONLY (the mayor, the coach, the barista at the corner cafe, a city council member, the crossing guard) — NEVER invent a real person's name
 - something the town is known for (a landmark, park, river, team, diner, main street)
Rules: casual and human, varied tone (proud, funny, annoyed, curious, hyped). Under 180 characters each. No hashtags. No @mentions. Do NOT state specific news as fact or name real living people. Vary sentence openings so the 10 don't sound alike.`

function pickN(arr, n) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a.slice(0, n)
}

async function generatePosts(city, state) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 1.0,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Town: ${city}, ${state}` },
          ],
        }),
      })
      if (r.status === 429) { await new Promise(s => setTimeout(s, 2000 * (attempt + 1))); continue }
      if (!r.ok) return null
      const j = await r.json()
      let txt = (j.choices?.[0]?.message?.content ?? '').trim()
      txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
      const arr = JSON.parse(txt)
      if (Array.isArray(arr) && arr.length >= POSTS_PER_HALL) {
        return arr.slice(0, POSTS_PER_HALL).map(s => String(s).slice(0, 240))
      }
    } catch { /* retry */ }
    await new Promise(s => setTimeout(s, 500))
  }
  return null
}

async function pageAll(table, cols, filter) {
  const out = []
  for (let off = 0; ; off += 1000) {
    let q = db.from(table).select(cols).range(off, off + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ── load halls, bots, and which halls are already seeded ─────────────────────
const gyms = await pageAll('gyms', 'id, city_name, state')
const bots = await pageAll('profiles', 'id, party', q => q.like('clerk_user_id', 'bot%'))
const seededRows = await pageAll('hall_posts', 'gym_id', q => q.eq('no_expire', true).not('gym_id', 'is', null))
const seeded = new Set(seededRows.map(r => r.gym_id))
const todo = gyms.filter(g => !seeded.has(g.id))
console.log(`halls: ${gyms.length} | bots: ${bots.length} | already seeded: ${seeded.size} | to do: ${todo.length}`)

let done = 0, posts = 0, failed = 0, idx = 0
async function worker() {
  while (idx < todo.length) {
    const g = todo[idx++]
    const texts = await generatePosts(g.city_name, g.state)
    if (!texts) { failed++; done++; continue }
    const hallBots = pickN(bots, BOTS_PER_HALL)
    const rows = texts.map((content, i) => {
      const bot = hallBots[i % BOTS_PER_HALL]
      const daysAgo = Math.random() * 30
      return {
        gym_id: g.id,
        profile_id: bot.id,
        party: bot.party ?? null,
        content,
        local: true,
        no_expire: true,
        score: Math.floor(Math.random() * 16),
        created_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
      }
    })
    const { error } = await db.from('hall_posts').insert(rows)
    if (error) { failed++; console.error(`insert ${g.city_name}: ${error.message}`) }
    else posts += rows.length
    done++
    if (done % 50 === 0) console.log(`${done}/${todo.length} halls · ${posts} posts · ${failed} failed`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`\nDONE — ${done} halls processed, ${posts} posts inserted, ${failed} failed`)

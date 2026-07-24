// Local reels audit: from a residential IP the YouTube watch page answers
// honestly (no bot wall), so this is the authoritative playability check.
// Lists every live video post with its true status; --purge deletes dead ones.
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'SOCS=CAI; CONSENT=YES+cb' }

const { data: posts } = await db.from('hall_posts')
  .select('id, link_url, link_title, created_at')
  .or('link_url.ilike.%youtube.com%,link_url.ilike.%youtu.be%,link_url.ilike.%tiktok.com%')
  .gte('created_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
  .order('created_at', { ascending: false })

const dead = []
for (const p of posts ?? []) {
  const vid = /(?:shorts\/|v=|youtu\.be\/)([\w-]{6,})/.exec(p.link_url ?? '')?.[1]
  if (!vid) { console.log('TIKTOK?', p.link_url); continue }
  const r = await fetch(`https://www.youtube.com/watch?v=${vid}`, { headers: UA })
  const html = await r.text()
  const status = /"playabilityStatus":\{"status":"([A-Z_]+)"/.exec(html)?.[1] ?? 'NO-STATUS'
  const inEmbed = /"playableInEmbed":(true|false)/.exec(html)?.[1] ?? '?'
  const ok = status === 'OK' && inEmbed !== 'false'
  console.log(ok ? 'OK  ' : 'DEAD', vid, status, `embed:${inEmbed}`, '—', (p.link_title ?? '').slice(0, 60))
  if (!ok) dead.push(p)
}
console.log(`\ntotal ${posts?.length ?? 0} · dead ${dead.length}`)
if (process.argv.includes('--purge') && dead.length) {
  for (const p of dead) await db.from('hall_posts').delete().eq('id', p.id)
  console.log(`purged ${dead.length}`)
}

// One-shot: fetch og:image previews for existing board posts that have a
// link but no image, so the boards show photo cards immediately.
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function ogImage(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    // Google News serves a bare page to bot-labeled UAs — a plain browser UA
    // gets the real page with og:image
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } })
    clearTimeout(t)
    const html = await r.text() // og tags sit at the BOTTOM of Google News pages
    const m = /property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)/.exec(html)
      || /content=["']([^"']+)["'][^>]*property=["']og:image/.exec(html)
      || /name=["']twitter:image["'][^>]*content=["']([^"']+)/.exec(html)
    const img = m?.[1]
    if (!img || !/^https?:\/\//.test(img)) return null
    return img.replace(/=s0-w300-rw$/, '=s0-w800-rw')
  } catch { return null }
}

const { data: posts } = await db.from('hall_posts')
  .select('id, link_url')
  .not('board_id', 'is', null)
  .not('link_url', 'is', null)
  .is('link_image', null)
console.log('posts to enrich:', posts?.length ?? 0)

let done = 0, found = 0, idx = 0
await Promise.all(Array.from({ length: 8 }, async () => {
  while (idx < posts.length) {
    const p = posts[idx++]
    const img = await ogImage(p.link_url)
    if (img) { await db.from('hall_posts').update({ link_image: img }).eq('id', p.id); found++ }
    done++
    if (done % 50 === 0) console.log(`${done}/${posts.length} (${found} images)`)
  }
}))
console.log(`DONE: ${found}/${done} got images`)

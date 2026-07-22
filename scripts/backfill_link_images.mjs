// Backfill v2: resolve every board post's Google News link to the REAL
// article URL and pull the real og:image (the generic Google-logo images from
// v1 are wiped and replaced).
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
async function fetchText(url, opts = {}, timeoutMs = 9000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const r = await fetch(url, { redirect: 'follow', ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers ?? {}) } })
    clearTimeout(t)
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

async function resolveGoogleNews(url) {
  const page = await fetchText(url)
  if (!page) return null
  const m = /data-p="([^"]+)"/.exec(page)
  if (!m) return null
  try {
    const dataP = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const obj = JSON.parse(dataP.replace('%.@.', '["garturlreq",'))
    const payload = new URLSearchParams({
      'f.req': JSON.stringify([[['Fbv4je', JSON.stringify([...obj.slice(0, -6), ...obj.slice(-2)]), null, 'generic']]]),
    })
    const txt = await fetchText('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: payload.toString(),
    })
    if (!txt) return null
    return /garturlres\\",\\"(https?:[^"\\]+)/.exec(txt)?.[1] ?? null
  } catch { return null }
}

function extractOg(html) {
  const m = /property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)/.exec(html)
    || /content=["']([^"']+)["'][^>]*property=["']og:image/.exec(html)
    || /name=["']twitter:image["'][^>]*content=["']([^"']+)/.exec(html)
  const img = m?.[1]
  return img && /^https?:\/\//.test(img) ? img : null
}

// wipe the generic Google-logo images first
await db.from('hall_posts')
  .update({ link_image: null })
  .not('board_id', 'is', null)
  .like('link_image', '%googleusercontent%')

const { data: posts } = await db.from('hall_posts')
  .select('id, link_url')
  .not('board_id', 'is', null)
  .like('link_url', '%news.google.com%')
  .limit(3000)
console.log('posts to resolve:', posts?.length ?? 0)

let done = 0, found = 0, idx = 0
await Promise.all(Array.from({ length: 8 }, async () => {
  while (idx < posts.length) {
    const p = posts[idx++]
    const real = await resolveGoogleNews(p.link_url)
    if (real) {
      let image = null
      const html = await fetchText(real, {}, 8000)
      if (html) image = extractOg(html)
      let domain = null
      try { domain = new URL(real).hostname.replace(/^www\./, '') } catch {}
      await db.from('hall_posts').update({ link_url: real, ...(domain ? { link_domain: domain } : {}), ...(image ? { link_image: image } : {}) }).eq('id', p.id)
      if (image) found++
    }
    done++
    if (done % 100 === 0) console.log(`${done}/${posts.length} (${found} images)`)
  }
}))
console.log(`DONE: ${found}/${done} images`)

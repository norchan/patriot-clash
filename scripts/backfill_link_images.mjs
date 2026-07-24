// Backfill v3 (boards polish Phase A — Michael's hard rule: no bot link post
// without a real image). For the last 7 days of BOT posts with a link_url and
// no link_image (boards AND town halls): re-resolve the article's og:image —
// found → update the row; still bare → DELETE the post so feeds stop showing
// broken title-only cards. Human posts are never touched.
// (v2 of this script was the 2026-07-21 Google-News URL decode backfill.)
// Usage: node scripts/backfill_link_images.mjs
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
  return img && /^https:\/\//.test(img) ? img : null
}

async function resolveArticle(url) {
  let real = url
  try {
    if (new URL(url).hostname.endsWith('news.google.com')) real = (await resolveGoogleNews(url)) ?? url
  } catch {}
  let image = null
  if (!real.includes('news.google.com')) {
    const html = await fetchText(real, {}, 8000)
    if (html) image = extractOg(html)
  }
  let domain = null
  try { domain = new URL(real).hostname.replace(/^www\./, '') } catch {}
  return { url: real, domain, image }
}

const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString()
const posts = []
for (let off = 0; ; off += 1000) {
  const { data, error } = await db.from('hall_posts')
    .select('id, link_url, profiles!hall_posts_profile_id_fkey(clerk_user_id)')
    .not('link_url', 'is', null)
    .is('link_image', null)
    .gte('created_at', since)
    .order('id')
    .range(off, off + 999)
  if (error) { console.error(error); process.exit(1) }
  posts.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const botPosts = posts.filter(p => p.profiles?.clerk_user_id?.startsWith('bot'))
console.log(`imageless link posts (7d): ${posts.length} · bot-authored: ${botPosts.length}`)

// resolve each unique link once (many rows can share one article)
const uniq = [...new Set(botPosts.map(p => p.link_url))]
const resolved = new Map()
let idx = 0, done = 0
await Promise.all(Array.from({ length: 8 }, async () => {
  while (idx < uniq.length) {
    const link = uniq[idx++]
    resolved.set(link, await resolveArticle(link))
    if (++done % 50 === 0) console.log(`resolved ${done}/${uniq.length}`)
  }
}))

let updated = 0, deleted = 0
for (const p of botPosts) {
  const a = resolved.get(p.link_url)
  if (a?.image) {
    const { error } = await db.from('hall_posts')
      .update({ link_url: a.url, ...(a.domain ? { link_domain: a.domain } : {}), link_image: a.image })
      .eq('id', p.id)
    if (!error) updated++
  } else {
    const { error } = await db.from('hall_posts').delete().eq('id', p.id)
    if (!error) deleted++
  }
}
console.log(`DONE — updated with image: ${updated} · deleted (no image found): ${deleted}`)

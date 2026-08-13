// Fetches a URL and scrapes OpenGraph/Twitter-card tags for a link preview
// (title + thumbnail + domain). Best effort: any failure returns just the
// domain so a post never fails because a site was slow.

import { lookup } from 'node:dns/promises'
import net from 'node:net'

export interface LinkPreview {
  url: string
  title: string | null
  image: string | null
  domain: string
  description: string | null
}

// ── SSRF GUARD (security pass 2026-08-12) ──────────────────────────────────
// This server fetches attacker-influenced URLs (a pasted post link). Without
// guarding, a link like http://169.254.169.254/… or http://10.0.0.5/ would
// make our server hit cloud metadata / internal hosts. Block them: http(s)
// only, no credentials in the URL, and the RESOLVED IP must be public. Every
// redirect hop is re-checked (an open redirect can't tunnel to a private IP).

/** True if an IP literal is loopback / private / link-local / metadata / ULA. */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 10) return true                          // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true   // RFC1918
    if (a === 192 && b === 168) return true            // RFC1918
    if (a === 127) return true                         // loopback
    if (a === 169 && b === 254) return true            // link-local + metadata (169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) return true  // CGNAT 100.64/10
    if (a === 0) return true                           // this-network
    if (a >= 224) return true                          // multicast / reserved
    return false
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase()
    if (x === '::1' || x === '::') return true          // loopback / unspecified
    if (x.startsWith('fe80')) return true               // link-local
    if (x.startsWith('fc') || x.startsWith('fd')) return true // unique-local
    // IPv4-mapped (::ffff:a.b.c.d) → check the embedded v4
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(x)
    if (m) return isBlockedIp(m[1])
    if (x.startsWith('::ffff:0:')) return true
    return false
  }
  return true // not a recognizable IP → refuse
}

const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata'])

/** Validate a URL string for outbound fetch. Returns the parsed URL or null. */
export async function safeFetchUrl(raw: string): Promise<URL | null> {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null // no creds in URL
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (BLOCKED_HOSTS.has(host)) return null
  // if the host is already an IP literal, check it directly
  if (net.isIP(host)) { return isBlockedIp(host) ? null : url }
  // otherwise resolve EVERY address and refuse if any is private (a hostname
  // can resolve to multiple / rebind between checks — reject on any hit)
  try {
    const addrs = await lookup(host, { all: true })
    if (!addrs.length) return null
    for (const a of addrs) if (isBlockedIp(a.address)) return null
    return url
  } catch { return null }
}

/** fetch() with SSRF-checked manual redirects (each hop re-validated). */
async function safeFetch(url: URL, init: RequestInit, maxHops = 4): Promise<Response | null> {
  let current: URL | null = url
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!current) return null
    const checked = await safeFetchUrl(current.toString())
    if (!checked) return null
    const res = await fetch(checked.toString(), { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      try { current = new URL(loc, checked) } catch { return null }
      continue
    }
    return res
  }
  return null // too many redirects
}

function pickMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    // property/name attribute in either order around content
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i')
    const m = re1.exec(html) ?? re2.exec(html)
    if (m?.[1]) return m[1]
  }
  return null
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  // SSRF guard: parse + resolve + reject private/metadata targets up front
  const url = await safeFetchUrl(rawUrl)
  if (!url) return null

  const base: LinkPreview = { url: url.toString(), title: null, image: null, domain: url.hostname.replace(/^www\./, ''), description: null }

  // TikTok's pages are JS-walled from datacenter IPs (og scrape gets nothing)
  // but its oEmbed endpoint answers cleanly — real thumbnail + title, which is
  // what the reels pager and feed cards need (A1 reels brief, Phase 2).
  // The oEmbed host is a fixed constant (tiktok.com), not user input — safe.
  if (/(^|\.)tiktok\.com$/.test(url.hostname.replace(/^www\./, ''))) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url.toString())}`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (r.ok) {
        const d: any = await r.json()
        if (d?.title) base.title = String(d.title).slice(0, 200)
        if (d?.thumbnail_url && /^https:\/\//.test(d.thumbnail_url)) base.image = d.thumbnail_url
      }
    } catch { /* fall through to the generic scrape */ }
    if (base.image) return base
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4500)
    // manual, per-hop-revalidated redirects: an open redirect on a public host
    // can't bounce us into a private IP
    const res = await safeFetch(url, {
      signal: ctrl.signal,
      // plain browser UA: Google News (and others) serve bot-labeled UAs a
      // stripped page with no og:image
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    })
    clearTimeout(timer)
    if (!res) return base
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return base

    // Only read the head-ish part — enough for meta tags
    const html = (await res.text()).slice(0, 200_000)

    base.title = pickMeta(html, ['og:title', 'twitter:title'])
      ?? /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1]?.trim()
      ?? null
    let img = pickMeta(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'])
    if (img) {
      try { img = new URL(img, url).toString() } catch { img = null }
    }
    base.image = img
    const desc = pickMeta(html, ['og:description', 'twitter:description', 'description'])
    if (desc) {
      base.description = desc
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").slice(0, 500)
    }
    // decode the most common HTML entities in titles
    if (base.title) {
      base.title = base.title
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").slice(0, 200)
    }
    return base
  } catch {
    return base
  }
}

// First http(s) URL inside a blob of text, if any
export function firstUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"')\]]+/i.exec(text)
  return m ? m[0] : null
}

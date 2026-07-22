// Fetches a URL and scrapes OpenGraph/Twitter-card tags for a link preview
// (title + thumbnail + domain). Best effort: any failure returns just the
// domain so a post never fails because a site was slow.

export interface LinkPreview {
  url: string
  title: string | null
  image: string | null
  domain: string
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
  let url: URL
  try {
    url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  } catch { return null }

  const base: LinkPreview = { url: url.toString(), title: null, image: null, domain: url.hostname.replace(/^www\./, '') }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4500)
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      // plain browser UA: Google News (and others) serve bot-labeled UAs a
      // stripped page with no og:image
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    })
    clearTimeout(timer)
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

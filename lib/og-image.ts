// Article resolution + og:image extraction for the news reporter bots.
// Google News RSS links are redirect stubs whose only og:image is the generic
// Google logo — the REAL article URL comes from Google's batchexecute
// endpoint (data-p decode), and the real page carries the real photo.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function fetchText(url: string, opts: RequestInit = {}, timeoutMs = 9000): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const r = await fetch(url, { redirect: 'follow', ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers ?? {}) } })
    clearTimeout(t)
    if (!r.ok) return null
    return await r.text()
  } catch {
    return null
  }
}

/** Decode a news.google.com/rss/articles/... link to the real article URL. */
export async function resolveGoogleNews(url: string): Promise<string | null> {
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
    const um = /garturlres\\",\\"(https?:[^"\\]+)/.exec(txt)
    return um?.[1] ?? null
  } catch {
    return null
  }
}

function extractOg(html: string): string | null {
  const m = /property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)/.exec(html)
    || /content=["']([^"']+)["'][^>]*property=["']og:image/.exec(html)
    || /name=["']twitter:image["'][^>]*content=["']([^"']+)/.exec(html)
  const img = m?.[1]
  return img && /^https?:\/\//.test(img) ? img : null
}

/** Resolve a (possibly Google News) link to { url, domain, image }. */
export async function resolveArticle(url: string): Promise<{ url: string; domain: string | null; image: string | null }> {
  let real = url
  try {
    if (new URL(url).hostname.endsWith('news.google.com')) {
      real = (await resolveGoogleNews(url)) ?? url
    }
  } catch { /* keep original */ }
  let image: string | null = null
  if (!real.includes('news.google.com')) {
    const html = await fetchText(real, {}, 8000)
    if (html) image = extractOg(html)
  }
  let domain: string | null = null
  try { domain = new URL(real).hostname.replace(/^www\./, '') } catch {}
  return { url: real, domain, image }
}

/** Back-compat: og:image of a URL (resolving Google News first). */
export async function ogImage(url: string): Promise<string | null> {
  return (await resolveArticle(url)).image
}

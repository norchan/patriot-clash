// Full-document og:image extraction. Google News puts its meta tags at the
// BOTTOM of a ~600KB page, so head-only readers (lib/link-preview) miss them —
// this reads the whole body. Used by the news reporter crons.

export async function ogImage(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      // bot-labeled UAs get a stripped page with no meta tags
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    })
    clearTimeout(t)
    if (!r.ok) return null
    const html = await r.text()
    const m = /property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)/.exec(html)
      || /content=["']([^"']+)["'][^>]*property=["']og:image/.exec(html)
      || /name=["']twitter:image["'][^>]*content=["']([^"']+)/.exec(html)
    let img = m?.[1]
    if (!img || !/^https?:\/\//.test(img)) return null
    // googleusercontent thumbs default to 300px — ask for a bigger render
    img = img.replace(/=s0-w300-rw$/, '=s0-w800-rw')
    return img
  } catch {
    return null
  }
}

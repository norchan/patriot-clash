// Detect video links (YouTube, Shorts, TikTok) so posts can render a real
// playable embed instead of a plain link card. Embedding via each platform's
// official player is allowed and free — re-hosting downloaded copies is not.

export interface VideoEmbed {
  kind: 'youtube' | 'tiktok'
  id: string
  /** iframe src for the official player */
  src: string
  /** thumbnail for feed cards (YouTube only — TikTok gives none without oEmbed) */
  thumb?: string
  vertical?: boolean // Shorts / TikTok get the 9:16 frame
}

async function fetchWithTimeout(url: string, ms: number, headers?: Record<string, string>) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal, headers })
  } finally {
    clearTimeout(t)
  }
}

/** Would this video actually play inside our embedded player?
 *  YouTube: scrape the watch page for playabilityStatus — status must be OK
 *  (catches deleted videos AND ended/offline live streams) and playableInEmbed
 *  must not be false (catches NFL-style copyright embed blocks that oEmbed
 *  misses). Falls back to oEmbed if the scrape yields nothing.
 *  TikTok: oEmbed 200. Non-video links return true. */
export async function videoAvailable(url: string | null | undefined): Promise<boolean> {
  const v = videoEmbed(url)
  if (!v) return true
  try {
    if (v.kind === 'youtube') {
      const r = await fetchWithTimeout(`https://www.youtube.com/watch?v=${v.id}`, 8000, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        // consent bypass — datacenter IPs get consent-walled otherwise
        'Cookie': 'SOCS=CAI; CONSENT=YES+cb',
      })
      if (r.ok) {
        const html = await r.text()
        const status = /"playabilityStatus":\{"status":"([A-Z_]+)"/.exec(html)?.[1]
        const inEmbed = /"playableInEmbed":(true|false)/.exec(html)?.[1]
        // LOGIN_REQUIRED = YouTube's bot wall (datacenter IPs get "sign in to
        // confirm you're not a bot") — that's a verdict on OUR REQUEST, not
        // the video; fall through to oEmbed instead of failing every video
        if (status && status !== 'LOGIN_REQUIRED' && status !== 'CONTENT_CHECK_REQUIRED') {
          return status === 'OK' && inEmbed !== 'false'
        }
      }
      // scrape gave nothing — oEmbed still catches hard-deleted + embed-disabled
      const oe = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.id}`)}`, 6000)
      return oe.ok
    }
    const oe = await fetchWithTimeout(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url!)}`, 6000)
    return oe.ok
  } catch {
    return true // network hiccup — don't false-positive a takedown
  }
}

export function videoEmbed(url: string | null | undefined): VideoEmbed | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\.|^m\./, '')

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const shorts = u.pathname.match(/^\/shorts\/([\w-]{6,})/)
      const id = shorts?.[1] ?? (u.pathname === '/watch' ? u.searchParams.get('v') : null)
      if (!id) return null
      return {
        kind: 'youtube', id, vertical: !!shorts,
        src: `https://www.youtube-nocookie.com/embed/${id}`,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      }
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).match(/^[\w-]{6,}/)?.[0]
      if (!id) return null
      return {
        kind: 'youtube', id,
        src: `https://www.youtube-nocookie.com/embed/${id}`,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      }
    }
    if (host === 'tiktok.com') {
      const m = u.pathname.match(/\/video\/(\d{8,})/)
      if (!m) return null
      return { kind: 'tiktok', id: m[1], vertical: true, src: `https://www.tiktok.com/player/v1/${m[1]}` }
    }
    return null
  } catch {
    return null
  }
}

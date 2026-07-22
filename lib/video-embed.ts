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

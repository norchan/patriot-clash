// Clique banner presets (public/banners). Creators pick one for the top of
// their clique page. `null` = the plain party-colored gradient.

export interface BannerPreset {
  id: string
  name: string
  url: string
}

export const BANNERS: BannerPreset[] = [
  { id: 'rally',  name: 'The Rally',   url: '/banners/rally.webp' },
  { id: 'crowd',  name: 'The Crowd',   url: '/banners/crowd.webp' },
  { id: 'hall',   name: 'Town Hall',   url: '/banners/hall.webp' },
  { id: 'street', name: 'Night Street', url: '/banners/street.webp' },
]

export const BANNER_URLS = new Set(BANNERS.map(b => b.url))

import type { MetadataRoute } from 'next'

// Let crawlers into the public pages; keep the authed app + APIs out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/explore', '/welcome', '/privacy'],
      disallow: ['/api/', '/map', '/townhall', '/profile', '/messages', '/cliques', '/settings', '/battle', '/arcade'],
    },
    sitemap: 'https://politicsgo.app/sitemap.xml',
  }
}

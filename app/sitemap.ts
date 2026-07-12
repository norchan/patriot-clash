import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: 'https://politicsgo.app/', lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: 'https://politicsgo.app/explore', lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: 'https://politicsgo.app/welcome', lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
  ]
}

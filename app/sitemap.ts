import type { MetadataRoute } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

function slugify(city: string, state: string): string {
  return `${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const base: MetadataRoute.Sitemap = [
    { url: 'https://politicsgo.app/', lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: 'https://politicsgo.app/explore', lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: 'https://politicsgo.app/welcome', lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: 'https://politicsgo.app/privacy', lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]

  // One entry per town hall (biggest cities first) so every hall page is
  // discoverable by search + the AdSense reviewer.
  try {
    const admin = createSupabaseAdminClient()
    const halls: { city_name: string; state: string }[] = []
    for (let p = 0; p < 3; p++) {
      const { data } = await admin.from('gyms').select('city_name, state')
        .order('population', { ascending: false }).range(p * 1000, p * 1000 + 999)
      if (!data?.length) break
      halls.push(...data)
      if (data.length < 1000) break
    }
    const seen = new Set<string>()
    for (const h of halls) {
      if (!h.city_name) continue
      const slug = slugify(h.city_name, h.state)
      if (seen.has(slug)) continue
      seen.add(slug)
      base.push({
        url: `https://politicsgo.app/explore/${slug}`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.6,
      })
    }
  } catch { /* sitemap still returns the static entries */ }

  return base
}

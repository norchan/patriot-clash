import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { powWowIsLive } from '@/lib/cliques'

// Server layout wrapping the client clique page — exists for the OG/Twitter
// preview on shared invite links (Michael): clique name, party + town, the
// banner as the card image, and a LIVE call-out when a pow-wow is running.

const SITE = 'https://politicsgo.app'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  try {
    const admin = createSupabaseAdminClient()
    const { data: clique } = await admin
      .from('cliques')
      .select('id, name, party, gym_id, banner_url, pow_wow_at')
      .eq('id', id)
      .maybeSingle()
    if (!clique) return { title: 'Cliques — PoliticsGo' }

    const [{ data: gym }, { count: memberCount }] = await Promise.all([
      clique.gym_id
        ? admin.from('gyms').select('city_name, state').eq('id', clique.gym_id).maybeSingle()
        : Promise.resolve({ data: null as any }),
      admin.from('clique_members').select('clique_id', { count: 'exact', head: true }).eq('clique_id', id),
    ])

    const live = powWowIsLive(clique.pow_wow_at)
    const party = clique.party === 'democrat' ? 'Democrat' : 'Republican'
    const town = gym ? ` out of ${gym.city_name}, ${gym.state}` : ''
    const title = live
      ? `🪶 POW-WOW LIVE — ${clique.name} · PoliticsGo`
      : `✊ ${clique.name} — a PoliticsGo clique`
    const description = live
      ? `The doors are open RIGHT NOW — everyone's welcome to hang out, watch live feeds, and chat. A ${party} clique${town} with ${memberCount ?? 0} members. Jump in!`
      : `A ${party} clique${town} with ${memberCount ?? 0} member${(memberCount ?? 0) !== 1 ? 's' : ''}. Join the fight on PoliticsGo — walk the map, battle rivals, hold the town halls.`
    const image = clique.banner_url
      ? (clique.banner_url.startsWith('http') ? clique.banner_url : `${SITE}${clique.banner_url}`)
      : `${SITE}/backgrounds/street_battle.jpg`

    return {
      title,
      description,
      alternates: { canonical: `${SITE}/cliques/${id}` },
      openGraph: {
        title, description,
        url: `${SITE}/cliques/${id}`,
        siteName: 'PoliticsGo',
        images: [{ url: image, width: 1200, height: 630 }],
        type: 'website',
      },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    }
  } catch {
    return { title: 'Cliques — PoliticsGo' }
  }
}

export default function CliqueShareLayout({ children }: { children: React.ReactNode }) {
  return children
}

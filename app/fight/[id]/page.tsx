import type { Metadata } from 'next'
import Link from 'next/link'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fighterLevel } from '@/lib/fighter'
import FightCta from '@/components/FightCta'

// PUBLIC FIGHT-ME PAGE (Michael 2026-07-23): the share-arena link. Post it
// anywhere (Twitter, texts) — anyone who clicks lands here, sees the callout,
// and one tap puts them in a live PvP against the link's owner. The owner
// gets the "called you out" push the moment the challenge fires and joins
// from the notification. Non-users detour through sign-up and come back.

const partyColor = (p: string | null) =>
  p === 'democrat' ? '#3b82f6' : p === 'republican' ? '#ef4444' : '#9ca3af'

async function getOwner(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('id, username, avatar_url, party, show_party, total_battles_won, total_battles_lost')
    .eq('id', id)
    .maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const owner = await getOwner(id)
  if (!owner) return { title: 'PoliticsGo' }
  const title = `⚔️ ${owner.username} challenges YOU to a fight!`
  const description = `Think you can take ${owner.username} in the ring? One tap and you're in a live PoliticsGo street fight — no account needed.`
  // same big battle-map card as the homepage (Michael) — personalized headline
  return {
    title,
    description,
    openGraph: {
      title, description,
      images: [{ url: '/og.jpg?v=2', width: 2400, height: 1260, alt: 'The PoliticsGo national battle map' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.jpg?v=2'] },
  }
}

export default async function FightMePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const owner = await getOwner(id)

  if (!owner) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-4xl mb-3">🥊</p>
          <p className="text-white font-black text-xl">This fighter doesn&apos;t exist</p>
          <Link href="/" className="text-purple-400 font-bold mt-3 inline-block">← PoliticsGo</Link>
        </div>
      </div>
    )
  }

  const level = fighterLevel(owner.total_battles_won ?? 0)
  const party = owner.show_party === false ? null : owner.party
  const color = partyColor(party)

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6"
      style={{ background: 'radial-gradient(circle at 50% 0%, #1f1533, #0b0716 60%, #050308)' }}>
      <div className="w-full max-w-sm text-center">
        <p className="text-gray-400 font-black tracking-[0.25em] text-xs">POLITICSGO STREET FIGHT</p>

        <div className="mt-6 flex items-center justify-center">
          {owner.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={owner.avatar_url} alt={owner.username}
              className="w-32 h-32 rounded-3xl object-cover border-4 shadow-2xl"
              style={{ borderColor: color, boxShadow: `0 0 40px ${color}55` }} />
          ) : (
            <div className="w-32 h-32 rounded-3xl border-4 flex items-center justify-center text-5xl font-black text-white"
              style={{ borderColor: color, background: `${color}22` }}>
              {owner.username[0]?.toUpperCase()}
            </div>
          )}
        </div>

        <h1 className="text-white font-black text-3xl mt-4">{owner.username}</h1>
        <p className="mt-1 text-sm font-bold" style={{ color }}>
          {party ? (party === 'democrat' ? '🔵 Democrat' : '🔴 Republican') : 'Fighter'} · LV {level}
          {(owner.total_battles_won ?? 0) > 0 && <span className="text-gray-500"> · {owner.total_battles_won}W-{owner.total_battles_lost ?? 0}L</span>}
        </p>

        <p className="text-gray-200 text-xl font-black mt-6 leading-snug">
          calls YOU out.<br />Think you can take the fight?
        </p>
        <p className="text-gray-500 text-sm mt-2">Live 1-on-1 street fight · 50 FP on the line</p>

        <div className="mt-8">
          <FightCta ownerId={owner.id} ownerName={owner.username} />
        </div>

        <Link href="/" className="text-gray-600 text-xs font-bold mt-8 inline-block hover:text-gray-400">
          What is PoliticsGo? →
        </Link>
      </div>
    </div>
  )
}

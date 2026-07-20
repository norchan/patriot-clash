import Link from 'next/link'
import type { Metadata } from 'next'
import { republicanEnemies, democratEnemies } from '@/config/enemies'

export const metadata: Metadata = {
  title: 'PoliticsGo Characters — the full satirical roster',
  description:
    'Every capturable character in PoliticsGo: stats, moves, rarity, and lore for the full Republican and Democrat satirical rosters.',
  alternates: { canonical: 'https://politicsgo.app/explore/characters' },
}

const TIER_COLOR: Record<string, string> = { common: '#9ca3af', rare: '#60a5fa', legendary: '#fbbf24' }

export default function CharactersIndex() {
  const groups = [
    { label: 'Republican roster', sub: 'Democrats hunt these characters', list: republicanEnemies },
    { label: 'Democrat roster', sub: 'Republicans hunt these characters', list: democratEnemies },
  ]
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-4xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
          <span className="mx-2">·</span>
          <Link href="/explore/guide" className="hover:text-white">How to play</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">The PoliticsGo Character Roster</h1>
        <p className="mt-3 text-gray-400 max-w-2xl">
          Twenty-plus original satirical caricatures — both parties get it equally. Tap any
          character for stats, moves, capture difficulty, and lore.
        </p>
        {groups.map(g => (
          <section key={g.label} className="mt-10">
            <h2 className="text-xl font-bold text-white">{g.label}</h2>
            <p className="text-gray-500 text-sm">{g.sub}</p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {g.list.map(e => (
                <Link key={e.id} href={`/explore/characters/${e.id}`}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center hover:border-purple-700 transition">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.image} alt={`${e.name} — PoliticsGo character`} className="h-28 mx-auto object-contain" loading="lazy" />
                  <div className="mt-2 font-bold text-white text-sm">{e.name}</div>
                  <div className="text-[11px] font-black" style={{ color: TIER_COLOR[e.tier] }}>{e.tier.toUpperCase()}</div>
                </Link>
              ))}
            </div>
          </section>
        ))}
        <footer className="mt-12 text-center text-gray-600 text-xs space-x-3">
          <Link href="/explore" className="hover:text-gray-400">Explore</Link>
          <Link href="/explore/guide" className="hover:text-gray-400">How to Play</Link>
          <Link href="/privacy" className="hover:text-gray-400">Privacy</Link>
          <Link href="/terms" className="hover:text-gray-400">Terms</Link>
        </footer>
      </div>
    </div>
  )
}

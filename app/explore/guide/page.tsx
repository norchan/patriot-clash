import Link from 'next/link'
import type { Metadata } from 'next'
import { republicanEnemies, democratEnemies } from '@/config/enemies'

// PUBLIC crawlable game guide — real, substantial content for players,
// search engines, and the AdSense review. Server-rendered, no login.

export const metadata: Metadata = {
  title: 'How to Play PoliticsGo — the complete guide',
  description:
    'Everything about PoliticsGo: picking your party, walking to earn Fighting Points, battling and capturing satirical characters, sieging town halls, PvP in the Arena, and the arcade.',
  alternates: { canonical: 'https://politicsgo.app/explore/guide' },
}

const TIER_LABEL: Record<string, string> = { common: 'Common', rare: 'Rare', legendary: 'Legendary' }
const TIER_COLOR: Record<string, string> = { common: '#9ca3af', rare: '#60a5fa', legendary: '#fbbf24' }

export default function GuidePage() {
  const roster = [
    { party: 'Republican characters (Democrats hunt these)', list: republicanEnemies },
    { party: 'Democrat characters (Republicans hunt these)', list: democratEnemies },
  ]
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore PoliticsGo</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">How to Play PoliticsGo</h1>
        <p className="mt-3 text-gray-400">
          PoliticsGo is a location-based political satire game. You pick a side — Democrat or
          Republican — then walk the real world to earn points, battle over-the-top caricatures
          of the other party, capture them for your collection, and fight for control of real
          town halls in your area. Both parties get roasted equally. It&apos;s a parody; bring a
          sense of humor.
        </p>

        <h2 className="text-xl font-bold text-white mt-10">1. Pick your party</h2>
        <p className="mt-2 text-gray-400">
          Your party decides everything: which characters spawn as your enemies, which town
          halls are friendly territory, and which side of the national rankings you fight for.
          Choose carefully — you can only switch once every 30 days, and switching abandons
          your clique.
        </p>

        <h2 className="text-xl font-bold text-white mt-8">2. Walk to earn Fighting Points</h2>
        <p className="mt-2 text-gray-400">
          Fighting Points (FP) are the game&apos;s energy and currency. Every 150 steps you take
          with the app open earns 100 FP, up to 30,000 steps a day, plus a 1,000 FP daily
          login bonus. FP pays for capture attempts, town hall siege attacks, PvP challenge
          stakes, and shop items. The Step Tracker (tap the 👟 bubble on the map) shows your
          daily ring, streak, and lifetime milestones.
        </p>

        <h2 className="text-xl font-bold text-white mt-8">3. Battle and capture characters</h2>
        <p className="mt-2 text-gray-400">
          Enemy characters spawn around town halls — the same spawns, in the same places, for
          every player. Get within a mile and tap one to battle: dodge its throws, land your
          own, and beat it before the clock runs out. Winning gives you a chance to capture the
          character for your collection; rarer characters are harder to beat, harder to catch,
          and worth more FP. Each party&apos;s two legendary characters spawn in only one spot per
          town hall — first come, first served, and every spawn disappears for the whole area
          after five players catch it.
        </p>

        <h2 className="text-xl font-bold text-white mt-8">4. Siege town halls</h2>
        <p className="mt-2 text-gray-400">
          Real town halls across America are capturable territory. If the other party holds
          one, attack it within 10 miles to grind its defense down — alone or with your
          clique — then land the final assault to flip it. Holders defend with FP donations
          and defense items. Every hall has its own town square feed where locals (and a lot
          of loud bots) argue, post news, and talk trash.
        </p>

        <h2 className="text-xl font-bold text-white mt-8">5. Fight players in the Arena</h2>
        <p className="mt-2 text-gray-400">
          The colosseum next to your local town hall is the Arena: build your fighter, pick a
          bobblehead, and challenge real players in live one-on-one fights — punches, kicks,
          blocks, dodges, and a power meter. Win fights to climb the national daily and
          all-time rankings.
        </p>

        <h2 className="text-xl font-bold text-white mt-8">6. The Arcade</h2>
        <p className="mt-2 text-gray-400">
          Next to your local hall you&apos;ll also find the Arcade: Pic Hunt (spot the
          differences), Checkmate Chamber (chess puzzles), Landslide (match-3), Tet-Kris
          (stack and clear), and the Slots Salute machines. Free arcade games pay out up to
          5,000 FP a day; slots take FP bets.
        </p>

        <h2 className="text-2xl font-black text-white mt-12">The full character roster</h2>
        <p className="mt-2 text-gray-400">
          Every character is an original satirical caricature. Commons are everywhere, rares
          take skill, and legendaries are genuinely hard to beat — and harder to catch.
        </p>
        {roster.map(group => (
          <section key={group.party} className="mt-8">
            <h3 className="text-lg font-bold text-white">{group.party}</h3>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
              {group.list.map(e => (
                <div key={e.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.image} alt={`${e.name} — PoliticsGo character`} className="h-32 mx-auto object-contain" loading="lazy" />
                  <div className="mt-2 font-bold text-white text-sm">{e.name}</div>
                  <div className="text-[11px] font-black tracking-wide" style={{ color: TIER_COLOR[e.tier] }}>
                    {TIER_LABEL[e.tier]?.toUpperCase()}
                  </div>
                  <p className="text-gray-500 text-xs mt-1">{e.description}</p>
                </div>
              ))}
            </div>
          </section>
        ))}

        <div className="mt-12 rounded-2xl border border-purple-800 bg-purple-950/30 p-6 text-center">
          <h2 className="text-xl font-black text-white">Ready to claim your town?</h2>
          <p className="text-gray-400 text-sm mt-1">Free to play · walk, battle, capture · politicsgo.app</p>
          <Link href="/" className="inline-block mt-4 px-6 py-3 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Play PoliticsGo
          </Link>
        </div>

        <footer className="mt-10 text-center text-gray-600 text-xs space-x-3">
          <Link href="/explore" className="hover:text-gray-400">Explore</Link>
          <Link href="/privacy" className="hover:text-gray-400">Privacy</Link>
          <Link href="/terms" className="hover:text-gray-400">Terms</Link>
        </footer>
      </div>
    </div>
  )
}

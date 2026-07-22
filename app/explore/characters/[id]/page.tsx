import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { republicanEnemies, democratEnemies, getEnemyById } from '@/config/enemies'
import { LORE, CAPTURE_NOTES } from '../lore'
import GpkCard from '@/components/GpkCard'

const ALL_ENEMIES = [...republicanEnemies, ...democratEnemies]

// One public wiki page per character — unique art, stats, moves, and written
// lore. 20+ crawlable content pages for search + the AdSense review.

export function generateStaticParams() {
  return [...republicanEnemies, ...democratEnemies].map(e => ({ id: e.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const e = getEnemyById(id)
  if (!e) return {}
  return {
    title: `${e.name} — PoliticsGo character guide`,
    description: `${e.name} (${e.tier} ${e.party} character): stats, moves, capture difficulty, and lore. ${e.description}`,
    alternates: { canonical: `https://politicsgo.app/explore/characters/${e.id}` },
  }
}

const TIER_COLOR: Record<string, string> = { common: '#9ca3af', rare: '#60a5fa', legendary: '#fbbf24' }

export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const e = getEnemyById(id)
  if (!e) notFound()
  const partyColor = e.party === 'democrat' ? '#3b82f6' : '#ef4444'
  const roster = e.party === 'democrat' ? democratEnemies : republicanEnemies
  const others = roster.filter(x => x.id !== e.id).slice(0, 4)
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore/characters" className="hover:text-white">← All characters</Link>
        </nav>
        <div className="sm:flex gap-8 items-start">
          {/* the character's trading card — same card as the Collection binder */}
          <div className="shrink-0 w-52 mx-auto sm:mx-0">
            <GpkCard name={e.name} image={e.image} tier={e.tier}
              cardNo={ALL_ENEMIES.findIndex(x => x.id === e.id) + 1} />
          </div>
          <div className="mt-6 sm:mt-0">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: partyColor }} />
              <span className="text-xs font-black tracking-widest" style={{ color: TIER_COLOR[e.tier] }}>{e.tier.toUpperCase()}</span>
            </div>
            <h1 className="text-3xl font-black text-white mt-1">{e.name}</h1>
            <p className="text-gray-400 mt-1">{e.description}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-2">
                <div className="text-[10px] text-gray-500 tracking-widest">HP</div>
                <div className="font-black text-white">{e.hp}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-2">
                <div className="text-[10px] text-gray-500 tracking-widest">POWER</div>
                <div className="font-black text-white">{e.power}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-2">
                <div className="text-[10px] text-gray-500 tracking-widest">FP REWARD</div>
                <div className="font-black text-yellow-300">{e.fpReward}</div>
              </div>
            </div>
          </div>
        </div>

        {LORE[e.id] && (
          <>
            <h2 className="text-xl font-bold text-white mt-10">Who is {e.name}?</h2>
            <p className="mt-2 text-gray-400">{LORE[e.id]}</p>
          </>
        )}

        <h2 className="text-xl font-bold text-white mt-8">Moves</h2>
        <div className="mt-3 space-y-2">
          {e.moves.map(m => (
            <div key={m.name} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5">
              <span className="text-xl">{m.emoji}</span>
              <span className="font-bold text-white text-sm flex-1">{m.name}</span>
              <span className="text-red-400 font-black text-sm">{m.damage} dmg</span>
            </div>
          ))}
        </div>

        <h2 className="text-xl font-bold text-white mt-8">Catching {e.name}</h2>
        <p className="mt-2 text-gray-400">{CAPTURE_NOTES[e.tier]}</p>

        <h2 className="text-xl font-bold text-white mt-8">More {e.party === 'democrat' ? 'Democrat' : 'Republican'} characters</h2>
        <div className="mt-3 grid grid-cols-4 gap-3">
          {others.map(o => (
            <Link key={o.id} href={`/explore/characters/${o.id}`} className="bg-gray-900 border border-gray-800 rounded-xl p-2 text-center hover:border-purple-700 transition">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.image} alt={o.name} className="h-16 mx-auto object-contain" loading="lazy" />
              <div className="text-[11px] font-bold text-gray-300 mt-1 truncate">{o.name}</div>
            </Link>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-purple-800 bg-purple-950/30 p-5 text-center">
          <p className="text-gray-300 text-sm">Hunt {e.name} in your own neighborhood.</p>
          <Link href="/" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Play PoliticsGo free
          </Link>
        </div>
      </div>
    </div>
  )
}

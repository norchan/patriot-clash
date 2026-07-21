'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import GuestAdGate from '@/components/GuestAdGate'

// GUEST ARCADE — the free games, no account needed (ad first). Scores and
// FP need an account: slots stays behind sign-up (it bets FP).

const GAMES = [
  { id: 'spotit', name: 'Pic Hunt', art: '/arcade/spotit.jpg', accent: '#38bdf8', free: true },
  { id: 'landslide', name: 'Landslide', art: '/arcade/landslide.jpg', accent: '#f472b6', free: true },
  { id: 'tetkris', name: 'Tet-Kris', art: '/arcade/tetkris.jpg', accent: '#c084fc', free: true },
  { id: 'chess', name: 'Checkmate Chamber', art: '/arcade/chess.jpg', accent: '#ffd700', free: true },
  { id: 'slots', name: 'Slots Salute', art: '/arcade/slots.jpg', accent: '#facc15', free: false },
]

export default function GuestArcadePage() {
  const router = useRouter()
  return (
    <div className="min-h-screen bg-gray-950 max-w-md mx-auto px-4 pb-10">
      <GuestAdGate gateKey="arcade" />

      <div className="pt-5 flex items-center justify-between">
        <button onClick={() => router.push('/play')} className="text-gray-400 text-sm font-bold hover:text-white">← Map</button>
        <span className="text-gray-500 text-xs font-black">👻 GUEST ARCADE</span>
      </div>
      <h1 className="mt-3 text-2xl font-black text-white">🕹️ The Arcade</h1>
      <p className="text-gray-500 text-sm mt-1">Play free. Sign up to keep the FP you win and set records on the leaderboards.</p>

      <div className="mt-5 grid gap-4">
        {GAMES.map(g => (
          <Link key={g.id} href={g.free ? `/arcade/${g.id}` : '/sign-up'}
            className="group relative rounded-2xl overflow-hidden border border-gray-800 hover:border-gray-600 transition block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={g.art} alt={g.name} className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300" />
            <div className="absolute inset-0 flex items-end justify-between p-3.5"
              style={{ background: 'linear-gradient(180deg, transparent 30%, rgba(3,7,18,0.92))' }}>
              <span className="font-black text-lg" style={{ color: g.accent }}>{g.name}</span>
              <span className={`text-[11px] font-black px-2.5 py-1 rounded-full ${
                g.free ? 'bg-emerald-600/80 text-white' : 'bg-gray-800/90 text-gray-300'}`}>
                {g.free ? 'PLAY FREE' : '🔒 SIGN UP'}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <Link href="/sign-up" className="block mt-6 py-3.5 rounded-2xl text-center font-black text-white"
        style={{ background: 'linear-gradient(90deg, #2563eb, #7c3aed, #dc2626)' }}>
        ⚔️ Sign up — keep your winnings
      </Link>
    </div>
  )
}

'use client'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Play, Zap } from 'lucide-react'

// The Arcade — premium cabinet cards with real key art, matching the
// PoliticsGo UI. One teaser card only; games get added as they're built.

interface GameEntry {
  id: string
  name: string
  tagline: string
  art: string
  accent: string
  href: string
  badge?: string
}

const GAMES: GameEntry[] = [
  {
    id: 'landslide', name: 'Landslide', art: '/arcade/landslide.jpg', accent: '#f472b6',
    tagline: 'Match 3 · cascades · win a landslide of FP', href: '/arcade/landslide', badge: 'EARN FP',
  },
  {
    id: 'tetkris', name: 'Tet-Kris', art: '/arcade/tetkris.jpg', accent: '#c084fc',
    tagline: 'Stack the blocks · clear rows · earn FP', href: '/arcade/tetkris', badge: 'EARN FP',
  },
  {
    id: 'slots', name: 'Slots Salute', art: '/arcade/slots.jpg', accent: '#facc15',
    tagline: '3 machines · bet FP · match 3 to win big', href: '/arcade/slots', badge: 'BET FP',
  },
]

export default function ArcadePage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-28">
      {/* header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="text-white font-bold text-lg">🕹️ Arcade</h1>
        <span className="ml-auto text-[11px] text-gray-500 flex items-center gap-1">
          <Zap size={12} className="text-yellow-400" /> Play to earn FP
        </span>
      </div>

      {/* cabinet cards */}
      <div className="px-4 pt-4 space-y-4 max-w-md mx-auto">
        {GAMES.map(g => (
          <button
            key={g.id}
            onClick={() => router.push(g.href)}
            className="relative w-full rounded-2xl overflow-hidden text-left transition active:scale-[0.98] group"
            style={{ border: '1px solid rgba(255,255,255,0.08)', boxShadow: `0 8px 30px rgba(0,0,0,0.5), 0 0 24px ${g.accent}14` }}
          >
            {/* key art */}
            <div className="relative aspect-[16/9] bg-gray-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.art} alt={g.name} className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 40%, rgba(3,7,18,0.92) 100%)' }} />
              {g.badge && (
                <span className="absolute top-2.5 right-2.5 text-[10px] font-black tracking-wider px-2 py-1 rounded-full"
                  style={{ background: `${g.accent}22`, color: g.accent, border: `1px solid ${g.accent}55`, backdropFilter: 'blur(4px)' }}>
                  ⚡ {g.badge}
                </span>
              )}
              {/* title + tagline over the art bottom */}
              <div className="absolute bottom-0 inset-x-0 px-4 pb-3 flex items-end justify-between gap-3">
                <div>
                  <div className="font-black text-xl tracking-wide" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.9)' }}>{g.name}</div>
                  <div className="text-gray-300 text-xs mt-0.5" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{g.tagline}</div>
                </div>
                <span className="shrink-0 flex items-center gap-1.5 text-xs font-black px-4 py-2 rounded-full transition group-active:scale-95"
                  style={{ background: g.accent, color: '#0b0714' }}>
                  <Play size={12} fill="#0b0714" /> PLAY
                </span>
              </div>
            </div>
          </button>
        ))}

        {/* single teaser — everything else stays hidden until it's real */}
        <div className="relative w-full rounded-2xl overflow-hidden border border-dashed border-gray-800 bg-gray-900/50 px-4 py-5 flex items-center gap-4">
          <div className="text-3xl">👾</div>
          <div>
            <div className="font-bold text-sm text-gray-300">Ballot Blaster</div>
            <div className="text-gray-600 text-xs">Blast the fake ballots · coming soon</div>
          </div>
          <span className="ml-auto text-[10px] font-black tracking-widest text-gray-600">SOON</span>
        </div>

        <p className="text-center text-gray-600 text-[11px] pt-1">
          Free games earn up to 5,000 FP a day · slots pay from your bets
        </p>
      </div>
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

// The Arcade — one shared hangout reachable from every town hall on the map.
// Vintage neon-cabinet vibe; games get wired up as we build them.

interface GameEntry {
  id: string
  name: string
  tagline: string
  emoji: string
  color: string
  href?: string          // set when the game is live
}

const GAMES: GameEntry[] = [
  { id: 'ballot-blaster', name: 'Ballot Blaster',   tagline: 'Blast the fake ballots, save the real ones', emoji: '👾', color: '#a855f7' },
  { id: 'flag-flappy',    name: 'Flappy Flag',       tagline: 'Flap through the gauntlet — one tap',        emoji: '🦅', color: '#ef4444' },
  { id: 'donkey-stomp',   name: 'Donkey Stomp',      tagline: 'Stack the barrels, climb to the top',        emoji: '🫏', color: '#3b82f6' },
  { id: 'coin-rush',      name: 'FP Coin Rush',      tagline: 'Grab the falling coins before time runs out', emoji: '🪙', color: '#f59e0b' },
  { id: 'whack-a-pol',    name: 'Whack-a-Pol',       tagline: 'Bonk the pols popping out of the swamp',      emoji: '🔨', color: '#22c55e' },
  { id: 'brick-breaker',  name: 'Filibuster Breaker', tagline: 'Smash the wall of red tape',                 emoji: '🧱', color: '#ec4899' },
]

export default function ArcadePage() {
  const router = useRouter()
  const [inserted, setInserted] = useState(false)

  // little "insert coin" flash on load
  useEffect(() => {
    const t = setInterval(() => setInserted(v => !v), 700)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen text-white overflow-hidden relative"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #2a0a4a 0%, #0a0616 60%, #050208 100%)', fontFamily: 'ui-monospace, monospace' }}>
      {/* scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.06]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 2px, transparent 4px)' }} />

      {/* header */}
      <div className="relative z-10 px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-purple-300 hover:text-white transition">
          <ArrowLeft size={18} />
        </button>
        <span className="text-purple-300 text-xs tracking-widest">EXIT</span>
      </div>

      {/* marquee */}
      <div className="relative z-10 text-center pt-3 pb-6">
        <h1 className="font-black tracking-[0.15em] text-4xl"
          style={{
            color: '#facc15',
            textShadow: '0 0 8px #f59e0b, 0 0 20px #a855f7, 0 3px 0 #7c2d12',
            animation: 'arcadeGlow 2.4s ease-in-out infinite',
          }}>
          🕹️ ARCADE
        </h1>
        <p className={`mt-2 text-sm tracking-widest transition-opacity ${inserted ? 'opacity-100' : 'opacity-30'}`}
          style={{ color: '#f472b6' }}>
          ★ INSERT COIN ★
        </p>
        <p className="text-gray-500 text-[11px] mt-1">Free to play · same arcade from every town hall</p>
      </div>

      {/* cabinet grid */}
      <div className="relative z-10 grid grid-cols-2 gap-3 px-4 pb-24 max-w-md mx-auto">
        {GAMES.map(g => {
          const live = !!g.href
          return (
            <button
              key={g.id}
              onClick={() => g.href && router.push(g.href)}
              disabled={!live}
              className="relative rounded-2xl p-4 text-center transition active:scale-95 overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(20,12,36,0.9), rgba(8,4,16,0.95))',
                border: `2px solid ${g.color}`,
                boxShadow: `0 0 14px ${g.color}55, inset 0 0 20px ${g.color}18`,
                opacity: live ? 1 : 0.92,
              }}
            >
              <div className="text-4xl mb-2" style={{ filter: `drop-shadow(0 0 8px ${g.color})` }}>{g.emoji}</div>
              <div className="font-black text-sm tracking-wide" style={{ color: g.color }}>{g.name}</div>
              <div className="text-gray-400 text-[10px] mt-1 leading-tight">{g.tagline}</div>
              <div className="mt-2 text-[10px] font-black tracking-widest"
                style={{ color: live ? '#4ade80' : '#6b7280' }}>
                {live ? '▶ PLAY' : 'COMING SOON'}
              </div>
            </button>
          )
        })}
      </div>

      {/* high-score footer strip */}
      <div className="relative z-10 fixed bottom-20 left-0 right-0 text-center pointer-events-none">
        <p className="text-[10px] tracking-[0.3em] text-purple-400/70">
          ▲ MORE GAMES DROPPING SOON ▲
        </p>
      </div>

      <style>{`
        @keyframes arcadeGlow {
          0%,100% { text-shadow: 0 0 8px #f59e0b, 0 0 20px #a855f7, 0 3px 0 #7c2d12; }
          50%     { text-shadow: 0 0 14px #fde047, 0 0 32px #ec4899, 0 3px 0 #7c2d12; }
        }
      `}</style>
    </div>
  )
}

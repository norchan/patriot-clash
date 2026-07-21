'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'

// ☰ site menu on the battle map page — the way to everything that no longer
// has a sidebar: game, boards, arcade, and the public explore pages.

const LINKS: { href: string; label: string; auth?: boolean }[] = [
  { href: '/boards', label: '📰 Boards' },
  { href: '/p', label: '☰ All psubs' },
  { href: '/battlemap', label: '🗺️ Full-screen map' },
  { href: '/explore/scoreboard', label: '📊 State scoreboard' },
  { href: '/explore/leaderboards', label: '🏆 Leaderboards' },
  { href: '/explore/characters', label: '🎭 Characters' },
  { href: '/explore/guide', label: '📖 How to play' },
  { href: '/explore/news', label: '🗞️ News' },
  { href: '/explore/faq', label: '❓ FAQ' },
]

export default function HomeMenu({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="Menu"
        className="p-2 -ml-2 text-gray-300 hover:text-white transition">
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 z-50 w-60 rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
            {(signedIn
              ? [{ href: '/map', label: '🎮 Open the game' }, { href: '/messages', label: '💬 Messages' }, ...LINKS]
              : [{ href: '/play', label: '👻 Play as guest' }, ...LINKS]
            ).map(l => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
                className="block px-4 py-3 text-sm font-bold text-gray-200 hover:bg-white/5 border-b border-black/30 last:border-0">
                {l.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

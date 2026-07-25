'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { useLocation } from '@/hooks/useLocation'
import { BoardsLeftNav, BoardsProfileCard } from '@/components/BoardsSidebars'

// DESKTOP RAILS, site-wide (Michael): every game page gets the boards
// treatment on xl+ — the game menu pinned LEFT (with the arcade cabinet list
// under it) and the player card pinned RIGHT. On /profile the right rail
// swaps to a taste of Local Players (the page itself already IS the profile).
// One geometry EVERYWHERE (boards included): feed max-w-2xl centered; rails
// 16px off its edges (fits exactly at the xl=1280 breakpoint). Offsets use
// 50% not 50vw — vw INCLUDES the scrollbar, so vw-based rails sat ~8px right
// of true center (right gap visibly wider than left, Michael).
// Mounted by the game layout on every non-immersive page.

const GAMES = [
  { href: '/arcade', label: 'Slots', emoji: '🎰' },
  { href: '/arcade/spotit', label: 'Pic Hunt', emoji: '🔍' },
  { href: '/arcade/chess', label: 'Checkmate Chamber', emoji: '♟️' },
  { href: '/arcade/landslide', label: 'Landslide', emoji: '🌀' },
  { href: '/arcade/tetkris', label: 'TetKris', emoji: '🧱' },
  { href: '/arcade/solitaire', label: 'Solitaire', emoji: '🃏' },
]

function ArcadeQuickList() {
  return (
    <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-[11px] font-black tracking-widest text-gray-500">🕹️ ARCADE</p>
      {GAMES.map(g => (
        <Link key={g.href} href={g.href}
          className="flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-white/5 hover:text-white transition">
          <span className="text-sm">{g.emoji}</span>
          <span className="text-sm font-bold">{g.label}</span>
        </Link>
      ))}
      <p className="px-4 py-2.5 text-[10px] font-bold text-emerald-400 border-t border-gray-800/60">
        Free to play — nothing to download
      </p>
    </div>
  )
}

function LocalPlayersPreview() {
  const { location } = useLocation()
  const [players, setPlayers] = useState<any[] | null>(null)
  useEffect(() => {
    if (!location) return
    fetch(`/api/players/closest?lat=${location.lat}&lng=${location.lng}`)
      .then(r => r.json())
      .then(d => setPlayers((d.players ?? []).slice(0, 6)))
      .catch(() => setPlayers([]))
  }, [location])
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-[11px] font-black tracking-widest text-gray-500">📍 LOCAL PLAYERS</p>
      {players === null && <p className="px-4 py-3 text-gray-600 text-xs">Finding players near you…</p>}
      {players?.length === 0 && <p className="px-4 py-3 text-gray-600 text-xs">Nobody close right now.</p>}
      {(players ?? []).map((p: any) => (
        <Link key={p.profile_id ?? p.id ?? p.username} href={p.profile_id ? `/player/${p.profile_id}` : '/active'}
          className="flex items-center gap-2.5 px-4 py-2 hover:bg-white/5 transition">
          {p.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0"
              style={{ boxShadow: `0 0 0 1.5px ${p.party === 'democrat' ? '#2563eb' : p.party === 'republican' ? '#dc2626' : '#6b7280'}` }} />
          ) : (
            <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-black text-white"
              style={{ background: p.party === 'democrat' ? '#2563eb' : p.party === 'republican' ? '#dc2626' : '#6b7280' }}>
              {(p.username ?? 'P')[0]?.toUpperCase()}
            </span>
          )}
          <span className="text-sm font-bold text-gray-200 truncate">{p.username}</span>
        </Link>
      ))}
      <Link href="/active"
        className="block px-4 py-2.5 text-xs font-black text-purple-400 hover:text-purple-300 border-t border-gray-800/60">
        See all local players →
      </Link>
    </div>
  )
}

export default function DesktopRails() {
  const pathname = usePathname()
  const { profile } = useProfile()
  return (
    <div className="hidden xl:block">
      <div className="fixed z-[70] w-56" style={{ top: '1.5rem', left: 'calc(50% - 36rem)' }}>
        <BoardsLeftNav signedIn={!!profile} />
        <ArcadeQuickList />
      </div>
      <div className="fixed z-[70] w-72" style={{ top: '1.5rem', left: 'calc(50% + 22rem)' }}>
        {pathname.startsWith('/profile') ? (
          <LocalPlayersPreview />
        ) : (
          <BoardsProfileCard profile={profile ? {
            username: profile.username,
            party: profile.party ?? null,
            avatar_url: (profile as any).avatar_url ?? null,
            fp_balance: profile.fp_balance ?? 0,
            total_battles_won: (profile as any).total_battles_won ?? 0,
          } : null} />
        )}
      </div>
    </div>
  )
}

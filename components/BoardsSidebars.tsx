'use client'
import Link from 'next/link'
import { Building2, Bell, ShoppingBag, Radar, Users, Settings, Clapperboard } from 'lucide-react'

// Desktop-only sidebars for /boards (Michael): Twitter-style columns.
// LEFT — the same destinations as the game ☰ menu (which hides on desktop
// boards, having moved here). RIGHT — the signed-in player's profile card,
// or a join card for guests. Both hidden under lg.

// mirrors app/(game)/layout.tsx menuItems — Michael's order; keep in sync
const NAV = [
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/reels', label: 'Reels', icon: Clapperboard },
  { href: '/active', label: 'Active Players', icon: Radar },
  { href: '/cliques', label: 'Active Cliques', icon: Users },
  { href: '/townhall/nearest', label: 'Town Hall', icon: Building2 },
  { href: '/shop', label: 'Shop', icon: ShoppingBag },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function BoardsLeftNav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
      {(signedIn ? NAV : NAV.filter(n => n.href === '/reels')).map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href}
          className="flex items-center gap-3 px-4 py-2.5 text-gray-300 hover:bg-white/5 hover:text-white transition border-b border-gray-800/60 last:border-0">
          <Icon size={16} className="text-gray-500" />
          <span className="text-sm font-bold">{label}</span>
        </Link>
      ))}
      {!signedIn && (
        <Link href="/sign-up"
          className="flex items-center justify-center gap-2 px-4 py-3 text-sm font-black text-white"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
          🎉 Play free
        </Link>
      )}
    </nav>
  )
}

export function BoardsProfileCard({ profile }: {
  profile: { username: string; party: string | null; avatar_url: string | null; fp_balance: number; total_battles_won: number } | null
}) {
  const color = profile?.party === 'democrat' ? '#2563eb' : profile?.party === 'republican' ? '#dc2626' : '#6b7280'
  if (!profile) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-center">
        <p className="text-white font-black">Join the fight</p>
        <p className="text-gray-500 text-xs mt-1">Pick a party, claim your town hall, argue on the boards.</p>
        <Link href="/sign-up"
          className="mt-3 block w-full py-2.5 rounded-xl font-black text-white text-sm"
          style={{ background: 'linear-gradient(135deg, #dc2626, #2563eb)' }}>
          Create free account
        </Link>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center gap-3">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover"
            style={{ boxShadow: `0 0 0 2px ${color}` }} />
        ) : (
          <span className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-black text-white"
            style={{ background: color }}>
            {profile.username[0]?.toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-white font-black truncate">{profile.username}</p>
          <p className="text-xs font-bold" style={{ color }}>
            {profile.party === 'democrat' ? 'Democrat' : profile.party === 'republican' ? 'Republican' : 'Independent'}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-black/40 py-2.5">
          <p className="text-yellow-400 font-black text-sm">⚡ {profile.fp_balance.toLocaleString()}</p>
          <p className="text-gray-600 text-[10px] font-bold mt-0.5">FIGHTING POINTS</p>
        </div>
        <div className="rounded-xl bg-black/40 py-2.5">
          <p className="text-white font-black text-sm">🏆 {profile.total_battles_won.toLocaleString()}</p>
          <p className="text-gray-600 text-[10px] font-bold mt-0.5">BATTLES WON</p>
        </div>
      </div>
      <Link href="/profile"
        className="mt-3 block w-full py-2.5 rounded-xl font-black text-white text-sm text-center bg-white/10 border border-white/10 hover:bg-white/15 transition">
        View profile →
      </Link>
    </div>
  )
}

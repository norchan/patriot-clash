'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { Map, Building2, MessageSquare, ShoppingBag, Users, Menu, User, Settings, Bell, LogOut, Radar, Landmark, Newspaper } from 'lucide-react'
import AdBanner, { ADS_ENABLED, AD_BAR_HEIGHT } from '@/components/AdBanner'

const navItems = [
  { href: '/map',            label: 'Map',       icon: Map },
  { href: '/profile',        label: 'Profile',   icon: User },
  { href: '/cliques',        label: 'Cliques',   icon: Users },
  { href: '/messages',       label: 'Messages',  icon: MessageSquare },
  { href: '/boards',         label: 'Boards',    icon: Newspaper },
]

const menuItems = [
  { href: '/',              label: 'Battle Map',     icon: Landmark },
  { href: '/townhall/nearest', label: 'Town Hall',   icon: Building2 },
  { href: '/notifications', label: 'Notifications',  icon: Bell },
  { href: '/shop',          label: 'Shop',           icon: ShoppingBag },
  { href: '/active',        label: 'Active Players', icon: Radar },
  { href: '/cliques',       label: 'Active Cliques', icon: Users },
  { href: '/townhall',      label: 'Active Halls',   icon: Building2 },
  { href: '/profile',       label: 'Profile',        icon: User },
  { href: '/settings',      label: 'Settings',       icon: Settings },
]

// Screens where leaving mid-action forfeits / loses progress — tapping the
// bottom nav, a menu item, or Back here pops an "are you sure?" (Michael).
function isActiveGame(path: string): boolean {
  return (
    path.startsWith('/battle') ||                 // sprite, PvP, and town-hall siege
    /^\/arcade\/slots\/[^/]+$/.test(path) ||       // a live slot machine
    ['/arcade/tetkris', '/arcade/landslide', '/arcade/solitaire', '/arcade/spotit', '/arcade/chess'].includes(path)
  )
}

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useClerk()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null) // confirm-before-leave target
  const activeGame = isActiveGame(pathname)

  // route through the confirm when in an active game, otherwise go straight
  function go(href: string) {
    setMenuOpen(false)
    if (activeGame) setPendingHref(href)
    else router.push(href)
  }

  // Prefetch the bottom-nav destinations so tapping a tab loads instantly
  // instead of fetching its JS + data on the tap.
  useEffect(() => {
    navItems.forEach(n => router.prefetch(n.href))
  }, [router])

  // Intercept the Back button while in a game: keep them put and confirm first.
  useEffect(() => {
    if (!activeGame) return
    window.history.pushState(null, '', window.location.href)
    const onPop = () => {
      window.history.pushState(null, '', window.location.href) // stay until they confirm
      setPendingHref(pathname.startsWith('/arcade') ? '/arcade' : '/map')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [activeGame, pathname])
  // ── Incoming PvP fight: pull the defender into the ring from ANY screen ──
  // Challenges arm instantly; the point is two REAL people fighting. On most
  // screens we flash a banner and auto-route into the fight. If they're mid-
  // game (arcade run / another battle), the banner stays with a JOIN button
  // instead of yanking them out.
  const [incomingFight, setIncomingFight] = useState<{ id: string; from: string } | null>(null)
  useEffect(() => {
    if (pathname.startsWith('/battle')) return // already in a ring
    const check = async () => {
      try {
        const res = await fetch('/api/pvp/pending')
        const d = await res.json()
        const c = d.challenge
        if (!c) return
        const key = `pvp_pulled_${c.id}`
        if (localStorage.getItem(key)) return
        localStorage.setItem(key, '1')
        setIncomingFight({ id: c.id, from: c.challenger_username })
      } catch {}
    }
    check()
    const iv = setInterval(check, 5000)
    return () => clearInterval(iv)
  }, [pathname])
  useEffect(() => {
    if (!incomingFight || activeGame) return // in-game: wait for their tap
    const t = setTimeout(() => {
      setIncomingFight(null)
      router.push(`/battle/pvp?id=${incomingFight.id}`)
    }, 1400)
    return () => clearTimeout(t)
  }, [incomingFight, activeGame, router])

  // unopened-DM badge on the Messages tab — polls lightly, refreshes on nav
  const [unreadDms, setUnreadDms] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/chat/unread').then(r => r.json())
      .then(d => { if (alive) setUnreadDms(d.count ?? 0) }).catch(() => {})
    load()
    const iv = setInterval(load, 25_000)
    return () => { alive = false; clearInterval(iv) }
  }, [pathname])
  // Immersive full-screen surfaces — no global menu button or ads over the
  // action: the battle screens and an actual slot machine (/arcade/slots/<id>,
  // but NOT the /arcade/slots chooser).
  const onBattleScreen = pathname.startsWith('/battle')
  const onSlotMachine = /^\/arcade\/slots\/[^/]+$/.test(pathname)
  const onTetKris = pathname === '/arcade/tetkris'
  const onLandslide = pathname === '/arcade/landslide'
  const immersive = onBattleScreen || onSlotMachine || onTetKris || onLandslide
  // AdSense policy: never show ads on surfaces that can contain private or
  // user-intimate content — DMs and photo-album screens are ad-free zones
  const adFreeSurface = pathname.startsWith('/messages') || pathname.startsWith('/player') || pathname.startsWith('/profile') || pathname.startsWith('/friends')
  const showAds = ADS_ENABLED && !immersive && !adFreeSurface

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col max-w-md mx-auto relative">
      {/* ── Global menu — upper right corner of the GAME COLUMN, every page
             (hidden on immersive battle screens). fixed is viewport-relative,
             so compute the column's right edge (max-w-md = 28rem) ── */}
      {!immersive && (
      <div className="fixed z-[80]" style={{ top: 'calc(0.75rem + env(safe-area-inset-top))', right: 'calc(max(0px, (100vw - 28rem) / 2) + 12px)' }}>
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="w-10 h-10 rounded-xl bg-gray-900/90 backdrop-blur border border-gray-700 flex items-center justify-center text-gray-300 hover:text-white shadow-lg transition"
          aria-label="Menu"
        >
          <Menu size={19} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0" onClick={() => setMenuOpen(false)} />
            <div className="absolute top-12 right-0 w-48 bg-gray-900/95 backdrop-blur rounded-xl border border-gray-700 shadow-2xl overflow-hidden">
              {menuItems.map(({ href, label, icon: Icon }) => (
                <button
                  key={href}
                  onClick={() => go(href)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-200 hover:bg-gray-800 transition border-b border-gray-800"
                >
                  <Icon size={16} className="text-gray-400" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
              <button
                onClick={() => { setMenuOpen(false); signOut(() => router.push('/sign-in')) }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-red-400 hover:bg-red-950/40 transition"
              >
                <LogOut size={16} />
                <span className="text-sm font-medium">Log Out</span>
              </button>
            </div>
          </>
        )}
      </div>
      )}

      <main className="flex-1 overflow-y-auto"
        style={{ paddingBottom: showAds ? `calc(5rem + ${AD_BAR_HEIGHT}px)` : '5rem' }}>
        {children}
      </main>

      {/* Fixed ad banner — every page except immersive battle screens */}
      {showAds && <AdBanner />}
      {/* z-[90] so the bar stays visible on immersive game surfaces (PvP arena
          is z-60); only the momentary countdown/result splashes (z-100+) cover it */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-gray-900 border-t border-gray-800 z-[90]">
        <div className="flex">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <button
                key={href}
                onClick={() => go(href)}
                className={`flex-1 py-3 flex flex-col items-center gap-1 transition-colors ${
                  isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span className="relative">
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                  {href === '/messages' && unreadDms > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center border border-gray-950">
                      {unreadDms > 99 ? '99+' : unreadDms}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── Incoming fight banner: auto-enters the ring (or JOIN if mid-game) ── */}
      {incomingFight && (
        <div className="fixed top-16 inset-x-4 z-[130] max-w-md mx-auto">
          <div className="rounded-2xl border-2 border-red-500 bg-gray-950/95 backdrop-blur px-4 py-3 shadow-2xl flex items-center gap-3"
            style={{ animation: 'fightPulse 0.8s ease-in-out infinite' }}>
            <span className="text-3xl">⚔️</span>
            <div className="min-w-0 flex-1">
              <p className="text-white font-black text-sm truncate">{incomingFight.from} called you out!</p>
              <p className="text-red-300 text-xs font-bold">{activeGame ? 'Tap JOIN when ready — the ring is waiting' : 'Entering the ring…'}</p>
            </div>
            {activeGame && (
              <button
                onClick={() => { const f = incomingFight; setIncomingFight(null); router.push(`/battle/pvp?id=${f.id}`) }}
                className="shrink-0 px-4 py-2.5 rounded-xl font-black text-white text-sm"
                style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                JOIN
              </button>
            )}
          </div>
          <style>{`@keyframes fightPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.02) } }`}</style>
        </div>
      )}

      {/* ── Leave-the-game confirm (nav / menu / Back during an active game) ── */}
      {pendingHref && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
          onClick={() => setPendingHref(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-gray-900 border border-gray-700 p-5 text-center shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-2">⚠️</div>
            <h3 className="text-white font-black text-lg">Leave the game?</h3>
            <p className="text-gray-400 text-sm mt-1">You&apos;ll forfeit this match and lose any progress in it.</p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setPendingHref(null)}
                className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-100 font-bold hover:bg-gray-700 transition">
                Stay
              </button>
              <button onClick={() => { const h = pendingHref; setPendingHref(null); router.push(h) }}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white font-black hover:bg-red-500 transition">
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The map's zoom/compass stack lives top-right too — push it down
          below the global menu button */}
      <style>{`.mapboxgl-ctrl-top-right { margin-top: 56px; }`}</style>
    </div>
  )
}

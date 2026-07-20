'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { Map, Building2, MessageSquare, ShoppingBag, Users, Menu, User, Settings, Bell, LogOut, Radar } from 'lucide-react'
import AdBanner, { ADS_ENABLED, AD_BAR_HEIGHT } from '@/components/AdBanner'

const navItems = [
  { href: '/map',            label: 'Map',       icon: Map },
  { href: '/profile',        label: 'Profile',   icon: User },
  { href: '/cliques',        label: 'Cliques',   icon: Users },
  { href: '/messages',       label: 'Messages',  icon: MessageSquare },
  { href: '/townhall/nearest', label: 'Town Hall', icon: Building2 },
]

const menuItems = [
  { href: '/notifications', label: 'Notifications',  icon: Bell },
  { href: '/shop',          label: 'Shop',           icon: ShoppingBag },
  { href: '/active',        label: 'Active Players', icon: Radar },
  { href: '/cliques',       label: 'Active Cliques', icon: Users },
  { href: '/townhall',      label: 'Active Halls',   icon: Building2 },
  { href: '/profile',       label: 'Profile',        icon: User },
  { href: '/settings',      label: 'Settings',       icon: Settings },
]

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useClerk()
  const [menuOpen, setMenuOpen] = useState(false)
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
                  onClick={() => { setMenuOpen(false); router.push(href) }}
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
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-gray-900 border-t border-gray-800 z-50">
        <div className="flex">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <button
                key={href}
                onClick={() => router.push(href)}
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

      {/* The map's zoom/compass stack lives top-right too — push it down
          below the global menu button */}
      <style>{`.mapboxgl-ctrl-top-right { margin-top: 56px; }`}</style>
    </div>
  )
}

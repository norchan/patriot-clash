'use client'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Map, Building2, MessageSquare, ShoppingBag, Users, Menu, User, Settings, Bell } from 'lucide-react'

const navItems = [
  { href: '/map',      label: 'Map',      icon: Map },
  { href: '/townhall', label: 'Halls',    icon: Building2 },
  { href: '/cliques',  label: 'Cliques',  icon: Users },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/shop',     label: 'Shop',     icon: ShoppingBag },
]

const menuItems = [
  { href: '/profile',          label: 'Profile',       icon: User },
  { href: '/profile#settings', label: 'Settings',      icon: Settings },
  { href: '/notifications',    label: 'Notifications', icon: Bell },
  { href: '/shop',             label: 'Shop',          icon: ShoppingBag },
]

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col max-w-md mx-auto relative">
      {/* ── Global menu — upper right on every page ─────────────────────── */}
      <div className="fixed top-3 right-3 z-[70]">
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
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-200 hover:bg-gray-800 transition border-b border-gray-800 last:border-0"
                >
                  <Icon size={16} className="text-gray-400" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <main className="flex-1 pb-20 overflow-y-auto">
        {children}
      </main>
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
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* The map's zoom/compass stack lives top-right too — nudge it down
          below the global menu button */}
      <style>{`.mapboxgl-ctrl-top-right { margin-top: 48px; }`}</style>
    </div>
  )
}

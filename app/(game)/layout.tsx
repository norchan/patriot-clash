'use client'
import { usePathname, useRouter } from 'next/navigation'
import { Map, Building2, User, ShoppingBag, Users } from 'lucide-react'

const navItems = [
  { href: '/map',      label: 'Map',     icon: Map },
  { href: '/townhall', label: 'Halls',   icon: Building2 },
  { href: '/cliques',  label: 'Cliques', icon: Users },
  { href: '/profile',  label: 'Profile', icon: User },
  { href: '/shop',     label: 'Shop',    icon: ShoppingBag },
]

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col max-w-md mx-auto relative">
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
    </div>
  )
}
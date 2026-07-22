'use client'
import { useRouter, usePathname } from 'next/navigation'
import { Map, User, Users, MessageSquare, Newspaper } from 'lucide-react'

// The game's bottom tab bar, mirrored onto the PUBLIC psub pages so the
// boards feel like part of the app (Michael). Guests tapping game tabs get
// bounced to the homepage/sign-in by the middleware — expected.

const TABS = [
  { href: '/map', label: 'Map', icon: Map },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/cliques', label: 'Cliques', icon: Users },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/boards', label: 'Boards', icon: Newspaper },
]

export default function PsubNav() {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-gray-900 border-t border-gray-800 z-50">
      <div className="flex">
        {TABS.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/boards'
            ? pathname === '/boards' || pathname.startsWith('/p')
            : pathname === href || pathname.startsWith(href + '/')
          return (
            <button key={href} onClick={() => router.push(href)}
              className={`flex-1 py-3 flex flex-col items-center gap-1 transition-colors ${
                isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

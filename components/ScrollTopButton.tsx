'use client'
import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

// Small blue "Top ↑" pill (Michael) — floats over the feed's lower right on
// BOTH mobile and desktop, appears after a screen of scrolling. FIXED
// positioning (sticky is dead under the game shell's overflow-y main), with
// the right offset calc'd to hug the feed column's edge:
//  - game pages: feed max-w-md (28rem) below xl, max-w-2xl (42rem) on xl
//  - `wide` (public p/ pages): feed max-w-2xl at every width

export default function ScrollTopButton({ bottomClass = 'bottom-5', wide = false }: { bottomClass?: string; wide?: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const on = () => setShow(window.scrollY > 500)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  if (!show) return null
  const align = wide
    ? 'right-[max(0.75rem,calc(50vw-20.25rem))]'
    : 'right-[max(0.75rem,calc(50vw-13.25rem))] xl:right-[max(0.75rem,calc(50vw-20.25rem))]'
  return (
    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top"
      className={`fixed ${bottomClass} ${align} z-40 h-9 pl-2.5 pr-3.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-black flex items-center gap-1 shadow-xl active:scale-95 transition`}>
      <ArrowUp size={14} /> Top
    </button>
  )
}

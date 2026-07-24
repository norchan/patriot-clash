'use client'
import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

// Small blue "Top ↑" pill, lower right (Michael) — appears once you've
// scrolled a screen or so, one tap glides back to the top. Used on /boards
// and the p/ psub pages.

export default function ScrollTopButton({ bottomClass = 'bottom-5' }: { bottomClass?: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const on = () => setShow(window.scrollY > 500)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  if (!show) return null
  return (
    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top"
      className={`fixed ${bottomClass} right-4 z-40 h-9 pl-2.5 pr-3.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-black flex items-center gap-1 shadow-xl active:scale-95 transition`}>
      <ArrowUp size={14} /> Top
    </button>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

// Small blue "Top ↑" pill (Michael) — appears after a screen of scrolling,
// one tap glides back up. STICKY inside the feed column (not viewport-fixed):
// on desktop the old fixed version drifted to the far right of the monitor,
// nowhere near the feed — sticky pins it to the column's own right edge at
// every width. Render it as the LAST child of the scrolling column.

export default function ScrollTopButton({ bottomClass = 'bottom-5' }: { bottomClass?: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const on = () => setShow(window.scrollY > 500)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <div className={`sticky ${bottomClass} z-40 h-0 pointer-events-none flex justify-end pr-3`}>
      {show && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top"
          className="pointer-events-auto -translate-y-full h-9 pl-2.5 pr-3.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-black flex items-center gap-1 shadow-xl active:scale-95 transition">
          <ArrowUp size={14} /> Top
        </button>
      )}
    </div>
  )
}

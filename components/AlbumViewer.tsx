'use client'
import { useState, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// Full-screen swipeable photo album lightbox. Give it a list of image URLs
// and a start index; swipe or tap the arrows to move through, tap the
// backdrop or ✕ to close.
export default function AlbumViewer({
  photos, start = 0, title, onClose,
}: {
  photos: { id: string; url: string }[]
  start?: number
  title?: string
  onClose: () => void
}) {
  const [i, setI] = useState(Math.min(start, Math.max(0, photos.length - 1)))
  const touchX = useRef(0)

  if (photos.length === 0) return null
  const go = (d: number) => setI(p => (p + d + photos.length) % photos.length)

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/95 flex flex-col"
      onClick={onClose}
      onTouchStart={e => { touchX.current = e.touches[0].clientX }}
      onTouchEnd={e => {
        const dx = e.changedTouches[0].clientX - touchX.current
        if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-bold truncate">{title}{photos.length > 1 ? ` · ${i + 1}/${photos.length}` : ''}</span>
        <button onClick={onClose} className="p-1"><X size={22} /></button>
      </div>

      <div className="flex-1 flex items-center justify-center relative" onClick={e => e.stopPropagation()}>
        <img
          src={photos[i].url}
          alt=""
          className="max-h-[80vh] max-w-full object-contain select-none"
          draggable={false}
        />
        {photos.length > 1 && (
          <>
            <button onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 rounded-full p-2 text-white">
              <ChevronLeft size={26} />
            </button>
            <button onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 rounded-full p-2 text-white">
              <ChevronRight size={26} />
            </button>
          </>
        )}
      </div>

      {photos.length > 1 && (
        <div className="flex gap-1.5 justify-center pb-6" onClick={e => e.stopPropagation()}>
          {photos.map((_, n) => (
            <button key={n} onClick={() => setI(n)}
              className="w-2 h-2 rounded-full transition"
              style={{ background: n === i ? 'white' : 'rgba(255,255,255,0.35)' }} />
          ))}
        </div>
      )}
    </div>
  )
}

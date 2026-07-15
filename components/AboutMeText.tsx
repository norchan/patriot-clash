'use client'

// Renders a player's "About Me" text safely:
// - plain text (never HTML)
// - URLs become clickable links
// - direct image URLs (jpg/png/gif/webp) render inline as photos
const URL_RE = /(https?:\/\/[^\s<>"']+)/g
const IMG_RE = /\.(jpe?g|png|gif|webp)(\?.*)?$/i

export default function AboutMeText({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <div className="text-sm text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
      {parts.map((part, i) => {
        if (!part) return null
        if (i % 2 === 1) {
          // odd indexes are the captured URLs
          if (IMG_RE.test(part)) {
            return (
              <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="block my-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={part} alt="" className="max-h-56 rounded-xl border border-gray-700 object-contain" />
              </a>
            )
          }
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer"
              className="text-purple-300 underline break-all hover:text-purple-200">
              {part}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </div>
  )
}

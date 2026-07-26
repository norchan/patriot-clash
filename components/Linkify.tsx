'use client'

// Linkify (Michael): URLs inside chat messages become real tappable links.
// Plain text in, text + <a> out — no HTML parsing, so nothing can inject.
export default function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer"
            className="underline break-all hover:opacity-80"
            onClick={e => e.stopPropagation()}>
            {p}
          </a>
        ) : (
          p
        )
      )}
    </>
  )
}

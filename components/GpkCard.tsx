// The GPK-style trading card — one component so the Collection binder and the
// public character wiki show the IDENTICAL card. Pure presentational
// (server-safe): interactivity (click-through, sell) lives in the callers.

const tierColor = (tier: string) =>
  tier === 'legendary' ? '#f59e0b' : tier === 'rare' ? '#8b5cf6' : '#6b7280'

export default function GpkCard({ name, image, tier, cardNo, copies = 0, captured = true }: {
  name: string
  image: string
  tier: string
  cardNo: number
  copies?: number
  captured?: boolean
}) {
  const color = tierColor(tier)
  return (
    <div className="relative w-full" style={{ aspectRatio: '2.5 / 3.5' }}>
      {/* outer card: classic GPK blue border w/ rounded corners */}
      <div className="absolute inset-0 rounded-xl overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
        style={{ background: captured ? '#1c63c7' : '#2a3648', padding: 7 }}>
        {/* white inner frame */}
        <div className="w-full h-full rounded-lg overflow-hidden relative"
          style={{ background: '#f3ead1', border: '3px solid #fdf6e3' }}>
          {/* art area: comic starburst */}
          <div className="absolute inset-0"
            style={{
              background: captured
                ? `repeating-conic-gradient(from 0deg at 50% 42%, ${color}26 0deg 9deg, #f3ead1 9deg 18deg)`
                : 'repeating-conic-gradient(from 0deg at 50% 42%, #94a3b81f 0deg 9deg, #22293a 9deg 18deg)',
            }} />
          <div className="absolute inset-0 flex items-end justify-center pb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={captured ? name : 'Uncaptured character'}
              className="h-[86%] object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.45)]"
              style={{ filter: captured ? 'none' : 'grayscale(1) brightness(0.3)' }} />
          </div>
          {!captured && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-5xl drop-shadow-[0_3px_4px_rgba(0,0,0,0.8)]">❓</span>
            </div>
          )}

          {/* card number pennant — top right, like the GPK '1a' */}
          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-sm text-[10px] font-black"
            style={{ background: '#d92c2c', color: '#fff', transform: 'rotate(3deg)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
            {cardNo}{captured ? 'a' : '?'}
          </div>

          {/* ×N sticker — round, like a price sticker */}
          {captured && copies > 1 && (
            <div className="absolute top-1.5 left-1.5 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black"
              style={{ background: '#ffd400', color: '#111', border: '2px solid #fff', transform: 'rotate(-8deg)', boxShadow: '0 2px 4px rgba(0,0,0,0.45)' }}>
              ×{copies}
            </div>
          )}
          {/* tier star strip */}
          {captured && (
            <div className="absolute top-10 left-1.5 text-[10px]" style={{ transform: 'rotate(-8deg)' }}>
              {tier === 'legendary' ? '⭐⭐⭐' : tier === 'rare' ? '⭐⭐' : '⭐'}
            </div>
          )}

          {/* skewed yellow NAME banner — the GPK signature */}
          <div className="absolute bottom-1.5 left-0 right-0 flex justify-center pointer-events-none">
            <div className="px-2.5 py-1 max-w-[94%]"
              style={{
                background: captured ? '#ffd400' : '#6b7280',
                transform: 'rotate(-3deg) skewX(-6deg)',
                border: '2px solid #111',
                boxShadow: '2px 2px 0 rgba(0,0,0,0.55)',
              }}>
              <span className="block text-[12px] leading-tight font-black uppercase tracking-tight truncate"
                style={{ color: captured ? '#c81e1e' : '#1f2937', transform: 'skewX(6deg)', textShadow: captured ? '1px 1px 0 #fff' : 'none', fontFamily: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' }}>
                {captured ? name : '???'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

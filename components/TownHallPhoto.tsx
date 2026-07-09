'use client'
import { useEffect } from 'react'

// Painted town hall for Siege Mode (public/halls/hall_{stage}.webp): one
// building rendered in three damage stages that swap as defense falls, with
// the holder's party flag flying from the clock tower. The wrecked stage has
// smoke and fire baked into the art, so its flag anchor sits lower (the
// spire is broken).

const stageFor = (damagePct: number) =>
  damagePct < 0.33 ? 'intact' : damagePct < 0.7 ? 'damaged' : 'wrecked'

export default function TownHallPhoto({
  damagePct, flagParty, shaking, height = 280,
}: {
  damagePct: number
  flagParty: 'democrat' | 'republican' | null
  shaking: boolean
  height?: number
}) {
  useEffect(() => {
    if (document.getElementById('hall-photo-kf')) return
    const s = document.createElement('style')
    s.id = 'hall-photo-kf'
    s.textContent = `
      @keyframes hallShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-7px)} 55%{transform:translateX(6px)} 80%{transform:translateX(-3px)} }
      @keyframes flagWave { 0%,100%{transform:skewY(0deg) scaleX(1)} 50%{transform:skewY(-4deg) scaleX(0.94)} }
    `
    document.head.appendChild(s)
  }, [])

  const stage = stageFor(Math.max(0, Math.min(1, damagePct)))
  const flagColor = flagParty === 'democrat' ? '#2563eb' : flagParty === 'republican' ? '#dc2626' : '#9ca3af'
  const anchor = stage === 'wrecked' ? { left: '44%', top: '10%' } : { left: '49%', top: '0%' }

  return (
    <div
      style={{
        position: 'relative', height,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: shaking ? 'hallShake 0.22s linear' : 'none',
        filter: 'drop-shadow(0 10px 14px rgba(0,0,0,0.45))',
      }}
    >
      <img
        key={stage}
        src={`/halls/hall_${stage}.webp`}
        alt="Town Hall"
        draggable={false}
        style={{ height: '100%', width: 'auto', userSelect: 'none' }}
      />
      {/* preload the other stages so damage swaps don't flash */}
      <img src="/halls/hall_damaged.webp" alt="" style={{ display: 'none' }} />
      <img src="/halls/hall_wrecked.webp" alt="" style={{ display: 'none' }} />

      {/* holder's flag on the tower */}
      <div style={{ position: 'absolute', ...anchor }}>
        <div style={{ width: 3, height: 24, background: '#d1d5db', borderRadius: 2 }} />
        <div
          style={{
            position: 'absolute', top: 1, left: 3, width: 30, height: 15,
            background: flagColor,
            clipPath: 'polygon(0 0, 100% 10%, 92% 50%, 100% 90%, 0 100%)',
            transformOrigin: 'left center',
            animation: 'flagWave 1.6s ease-in-out infinite',
            transition: 'background 600ms ease',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
        />
      </div>
    </div>
  )
}

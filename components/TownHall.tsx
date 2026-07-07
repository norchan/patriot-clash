'use client'
import { useEffect } from 'react'

// Procedural town hall building for Siege Mode. damagePct (0-1) reveals
// progressive destruction: cracks → broken windows → smashed column.

export default function TownHall({
  flagParty, damagePct, shaking = false, height = 240,
}: {
  flagParty: 'democrat' | 'republican' | null
  damagePct: number      // 0 pristine … 1 rubble
  shaking?: boolean
  height?: number
}) {
  useEffect(() => {
    if (document.getElementById('townhall-kf')) return
    const s = document.createElement('style')
    s.id = 'townhall-kf'
    s.textContent = `
      @keyframes thShake { 0%,100%{transform:translate(0,0) rotate(0deg)} 25%{transform:translate(-5px,2px) rotate(-0.6deg)} 50%{transform:translate(4px,-2px) rotate(0.5deg)} 75%{transform:translate(-3px,1px)} }
      @keyframes thFlag  { 0%,100%{transform:skewX(0deg)} 50%{transform:skewX(-6deg)} }
      @keyframes thSmoke { 0%{transform:translateY(0) scale(0.7);opacity:0} 20%{opacity:0.55} 100%{transform:translateY(-46px) scale(1.6);opacity:0} }
    `
    document.head.appendChild(s)
  }, [])

  const flagColor = flagParty === 'democrat' ? '#2563eb' : flagParty === 'republican' ? '#dc2626' : '#9ca3af'
  const stone = '#cdc6b8'
  const stoneDark = '#a89f8d'
  const roof = '#8d8577'
  const d = Math.max(0, Math.min(1, damagePct))

  return (
    <div style={{ animation: shaking ? 'thShake 0.18s linear' : 'none', width: height * (300 / 260), height }}>
      <svg viewBox="0 0 300 260" width="100%" height="100%" style={{ overflow: 'visible' }}>
        {/* flag */}
        <rect x={148} y={10} width={3} height={46} fill="#6b7280" />
        <g style={{ animation: 'thFlag 2.2s ease-in-out infinite', transformOrigin: '151px 14px' }}>
          <rect x={151} y={12} width={34} height={20} rx={2} fill={flagColor} style={{ transition: 'fill 600ms ease' }} />
        </g>

        {/* dome + cupola */}
        <rect x={143} y={52} width={14} height={10} fill={stoneDark} />
        <path d="M 105 96 q 45 -46 90 0 z" fill={roof} />
        <rect x={100} y={94} width={100} height={8} fill={stoneDark} />

        {/* pediment */}
        <path d="M 60 132 L 150 100 L 240 132 z" fill={stone} />
        <path d="M 74 130 L 150 104 L 226 130 z" fill={stoneDark} opacity={0.35} />
        {/* pediment chip at 50% */}
        {d > 0.5 && <path d="M 150 100 L 172 108 L 160 112 L 150 104 z" fill="#171410" />}
        <rect x={56} y={130} width={188} height={10} fill={stoneDark} />

        {/* columns */}
        {[78, 122, 166, 210].map((x, i) => (
          <g key={x}>
            <rect x={x} y={140} width={14} height={8} fill={stoneDark} />
            {/* column 3 shatters at 75% damage */}
            {d > 0.75 && i === 2 ? (
              <>
                <rect x={x + 1} y={148} width={12} height={22} fill={stone} />
                <rect x={x - 1} y={196} width={16} height={22} fill={stone} transform={`rotate(6 ${x + 7} 206)`} />
                <circle cx={x + 3} cy={222} r={5} fill={stoneDark} />
                <circle cx={x + 13} cy={224} r={4} fill={stone} />
              </>
            ) : (
              <rect x={x + 1} y={148} width={12} height={72} fill={stone} />
            )}
            <rect x={x} y={218} width={14} height={6} fill={stoneDark} />
          </g>
        ))}

        {/* facade behind columns */}
        <rect x={64} y={140} width={172} height={84} fill="#8f8776" opacity={0.55} />

        {/* door + windows */}
        <rect x={138} y={178} width={24} height={46} rx={3} fill={d > 0.5 ? '#0c0a08' : '#4a3d2c'} />
        <rect x={100} y={168} width={16} height={22} rx={2} fill={d > 0.25 ? '#0c0a08' : '#bcd6e8'} />
        <rect x={184} y={168} width={16} height={22} rx={2} fill={d > 0.6 ? '#0c0a08' : '#bcd6e8'} />
        {/* broken glass shards on darkened windows */}
        {d > 0.25 && <path d="M 102 170 l 5 8 l 4 -6 l 3 9" stroke="#3b4956" strokeWidth={1.2} fill="none" />}

        {/* cracks */}
        {d > 0.2 && <path d="M 90 224 l 6 -14 l -4 -8 l 7 -12" stroke="#2a251d" strokeWidth={2} fill="none" strokeLinecap="round" />}
        {d > 0.45 && <path d="M 205 224 l -5 -18 l 6 -9 l -5 -14 l 6 -8" stroke="#2a251d" strokeWidth={2} fill="none" strokeLinecap="round" />}
        {d > 0.45 && <path d="M 150 140 l -8 -10 l 3 -8" stroke="#2a251d" strokeWidth={1.6} fill="none" strokeLinecap="round" />}
        {d > 0.7 && <path d="M 120 132 l 10 -14 l -6 -10 M 240 136 l -10 -12" stroke="#1c1813" strokeWidth={2.2} fill="none" strokeLinecap="round" />}

        {/* base steps */}
        <rect x={52} y={224} width={196} height={10} fill={stone} />
        <rect x={44} y={234} width={212} height={10} fill={stoneDark} />
        <rect x={36} y={244} width={228} height={10} fill={stone} />
      </svg>

      {/* smoke plumes once badly damaged */}
      {d > 0.5 && (
        <div style={{ position: 'relative', height: 0 }}>
          <div style={{
            position: 'absolute', left: '30%', bottom: height * 0.42, width: 26, height: 60,
            background: 'radial-gradient(ellipse at 50% 90%, rgba(40,36,30,0.7), transparent 70%)',
            filter: 'blur(5px)', animation: 'thSmoke 2.6s ease-out infinite',
          }} />
          {d > 0.75 && (
            <div style={{
              position: 'absolute', left: '58%', bottom: height * 0.36, width: 32, height: 70,
              background: 'radial-gradient(ellipse at 50% 90%, rgba(30,26,22,0.75), transparent 70%)',
              filter: 'blur(6px)', animation: 'thSmoke 3.2s ease-out infinite 0.9s',
            }} />
          )}
        </div>
      )}
    </div>
  )
}

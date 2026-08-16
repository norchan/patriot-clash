'use client'
import { useEffect, useState } from 'react'
import { isoPos, TILE_W, TILE_H } from '@/lib/base-stage'

// ═══ BASE IDLE LIFE (Crown Jewel B3) ════════════════════════════════════════
// Ambient motion for the yard, shared by home HQ and the raid preview so the
// two never fork. Everything is CSS keyframes on a handful of positioned
// spans — no rAF, no per-frame JS, no new art. Rendered as a child of
// IsoYard, so every effect lives in logical stage coordinates and rides the
// B1 camera transform.
//
// Budget: each item is 1–3 DOM nodes, compositor-only animations
// (transform/opacity). A fully built lot lands around ~30 nodes.
// Accessibility/perf: prefers-reduced-motion collapses everything except the
// (static) ready badges; a hidden tab pauses the whole layer.
//
// The sprite-level idles (flag sway, dog bob) animate the building images
// themselves via IsoCellSpec.idle — their keyframes live here too, so this
// component must be mounted (IsoYard always mounts it).

export type IdleFxKind = 'glow' | 'smoke' | 'ping' | 'glint' | 'dust' | 'upgrade' | 'ready'
export interface IdleFxItem {
  pad: number
  kind: IdleFxKind
  /** offsets from the pad anchor, logical px (up = positive dy) */
  dx?: number
  dy?: number
  /** ready badge content */
  emoji?: string
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

function useTabHidden() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden')
    on()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}

export default function BaseIdleFx({ items }: { items: IdleFxItem[] }) {
  const reduced = usePrefersReducedMotion()
  const hidden = useTabHidden()
  const live = reduced ? items.filter(i => i.kind === 'ready') : items
  return (
    <>
      {/* all bs* keyframes for the yard — including the sprite idles
          (bsSway/bsDog) that IsoYard applies to flag + doberman images */}
      <style>{`
        @keyframes bsSway { 0%,100%{transform:translate(-50%,-100%) rotate(-2.4deg)} 50%{transform:translate(-50%,-100%) rotate(2.4deg)} }
        @keyframes bsSwayM { 0%,100%{transform:translate(-50%,-100%) scaleX(-1) rotate(2.4deg)} 50%{transform:translate(-50%,-100%) scaleX(-1) rotate(-2.4deg)} }
        @keyframes bsDog { 0%,62%,100%{transform:translate(-50%,-100%)} 70%{transform:translate(-50%,-101.6%) rotate(-1.4deg)} 84%{transform:translate(-50%,-100.4%) rotate(1.1deg)} }
        @keyframes bsDogM { 0%,62%,100%{transform:translate(-50%,-100%) scaleX(-1)} 70%{transform:translate(-50%,-101.6%) scaleX(-1) rotate(1.4deg)} 84%{transform:translate(-50%,-100.4%) scaleX(-1) rotate(-1.1deg)} }
        @keyframes bsSmoke { 0%{transform:translate(-50%,0) scale(.5);opacity:0} 18%{opacity:.5} 100%{transform:translate(-50%,-66px) scale(1.4);opacity:0} }
        @keyframes bsPing { 0%{transform:translate(-50%,-50%) scale(.25);opacity:.75} 100%{transform:translate(-50%,-50%) scale(1.7);opacity:0} }
        @keyframes bsGlint { 0%,80%{transform:translateX(-64px) rotate(-16deg);opacity:0} 84%{opacity:.9} 94%{transform:translateX(64px) rotate(-16deg);opacity:0} 100%{opacity:0} }
        @keyframes bsGlow { 0%,100%{opacity:.15} 50%{opacity:.42} }
        @keyframes bsBob { 0%,100%{transform:translate(-50%,0)} 50%{transform:translate(-50%,-9px)} }
        @keyframes bsSparkle { 0%{transform:translateY(0) scale(.5);opacity:0} 22%{opacity:1} 100%{transform:translateY(-46px) scale(1.05);opacity:0} }
        @keyframes bsRing { 0%,100%{opacity:.3} 50%{opacity:.85} }
      `}</style>
      <div className="absolute inset-0 pointer-events-none"
        style={hidden ? { animationPlayState: 'paused' } : undefined}>
        {live.map((it, i) => {
          const { x, y, depth } = isoPos(it.pad)
          const px = x + (it.dx ?? 0)
          const py = y - (it.dy ?? 0)
          const z = depth * 10 + 5
          const paused = hidden ? ('paused' as const) : ('running' as const)
          switch (it.kind) {
            case 'glow': // warm window light breathing on the facade
              return <span key={i} className="absolute" style={{
                left: px, top: py, width: 96, height: 72, zIndex: z,
                transform: 'translate(-50%,-50%)',
                background: 'radial-gradient(ellipse, rgba(255,190,90,0.55) 0%, transparent 68%)',
                mixBlendMode: 'screen',
                animation: 'bsGlow 3.8s ease-in-out infinite', animationPlayState: paused,
              }} />
            case 'smoke': // two staggered puffs drifting off a chimney
              return (
                <span key={i} className="absolute" style={{ left: px, top: py, zIndex: z }}>
                  {[0, 1].map(k => (
                    <span key={k} className="absolute rounded-full" style={{
                      left: 0, top: 0, width: 20 + k * 6, height: 20 + k * 6,
                      background: 'radial-gradient(circle, rgba(226,226,230,0.5) 0%, transparent 70%)',
                      filter: 'blur(1.5px)',
                      animation: `bsSmoke ${3 + k * 0.6}s ease-out ${k * 1.5}s infinite`, animationPlayState: paused,
                    }} />
                  ))}
                </span>
              )
            case 'ping': // broadcast ring off the tower mast
              return <span key={i} className="absolute rounded-full" style={{
                left: px, top: py, width: 30, height: 30, zIndex: z,
                border: '2.5px solid rgba(147,197,253,0.8)',
                boxShadow: '0 0 8px rgba(147,197,253,0.5)',
                animation: 'bsPing 2.7s ease-out infinite', animationPlayState: paused,
              }} />
            case 'glint': // specular sweep across the panels every few seconds
              return <span key={i} className="absolute" style={{
                left: px - 32, top: py, width: 26, height: 46, zIndex: z,
                background: 'linear-gradient(100deg, transparent 15%, rgba(255,255,255,0.85) 50%, transparent 85%)',
                filter: 'blur(1px)', mixBlendMode: 'screen',
                animation: 'bsGlint 4.8s linear infinite', animationPlayState: paused,
              }} />
            case 'dust': // training activity at the barracks door
              return (
                <span key={i} className="absolute" style={{ left: px, top: py, zIndex: z }}>
                  {[0, 1].map(k => (
                    <span key={k} className="absolute rounded-full" style={{
                      left: k * 14 - 7, top: 0, width: 15 + k * 5, height: 15 + k * 5,
                      background: 'radial-gradient(circle, rgba(196,164,110,0.5) 0%, transparent 70%)',
                      filter: 'blur(1px)',
                      animation: `bsSmoke ${2 + k * 0.5}s ease-out ${k * 0.9}s infinite`, animationPlayState: paused,
                    }} />
                  ))}
                </span>
              )
            case 'upgrade': // UNMISSABLE construction: pulsing gold pad ring + rising sparks
              return (
                <span key={i} className="absolute" style={{ left: x, top: y, zIndex: z }}>
                  <span className="absolute" style={{
                    left: -TILE_W * 0.36, top: -TILE_H * 0.36, width: TILE_W * 0.72, height: TILE_H * 0.72,
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                    border: '3px solid rgba(251,191,36,0.9)',
                    background: 'rgba(251,191,36,0.12)',
                    animation: 'bsRing 1.6s ease-in-out infinite', animationPlayState: paused,
                  }} />
                  {[0, 1, 2].map(k => (
                    <span key={k} className="absolute select-none" style={{
                      left: (k - 1) * 22 - 6, top: -34 - k * 8, fontSize: 15,
                      animation: `bsSparkle ${1.7 + k * 0.4}s ease-out ${k * 0.55}s infinite`, animationPlayState: paused,
                    }}>✨</span>
                  ))}
                </span>
              )
            case 'ready': // CoC-style claim bubble bobbing over the building
              return (
                <span key={i} className="absolute" style={{ left: px, top: py, zIndex: 2000 + depth,
                  animation: 'bsBob 1.5s ease-in-out infinite', animationPlayState: paused }}>
                  <span className="flex items-center justify-center rounded-full select-none" style={{
                    width: 40, height: 40, fontSize: 20,
                    background: 'rgba(255,255,255,0.95)',
                    border: '3px solid #f59e0b',
                    boxShadow: '0 0 14px rgba(245,158,11,0.8), 0 4px 8px rgba(0,0,0,0.4)',
                  }}>{it.emoji ?? '⚡'}</span>
                  <span className="absolute left-1/2 -bottom-1.5 -translate-x-1/2" style={{
                    width: 0, height: 0,
                    borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
                    borderTop: '9px solid #f59e0b',
                  }} />
                </span>
              )
          }
        })}
      </div>
    </>
  )
}

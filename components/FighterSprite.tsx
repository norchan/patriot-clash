'use client'
import { useEffect } from 'react'
import type { FighterDesign } from '@/lib/fighter'
import type { FighterPose } from '@/components/FighterRig'

// Painted fighting-game sprites (public/sprites/{archetype}_{color}_{pose}.webp).
// Sprites are authored facing LEFT in Republican red; Democrats load the
// recolored blue set. Build stretches the sprite, tone shift is a filter.

const SPRITE_POSE: Record<FighterPose, string> = {
  idle: 'idle',
  block: 'idle',
  dodge: 'hit',
  jab: 'punch',
  cross: 'punch',
  hook: 'punch',
  uppercut: 'punch',
  kick: 'kick',
  jumpkick: 'jumpkick',
  special: 'special',
  hit: 'hit',
  ko: 'ko',
  victory: 'special',
}

const BUILD_SCALE: Record<FighterDesign['body'], number> = {
  skinny: 0.88,
  average: 1,
  athletic: 1.07,
  fat: 1.22,
}

export function spriteUrl(design: FighterDesign, party: 'democrat' | 'republican', pose: FighterPose) {
  const color = party === 'democrat' ? 'blue' : 'red'
  return `/sprites/${design.archetype}_${color}_${SPRITE_POSE[pose]}.webp`
}

export default function FighterSprite({
  design, party, pose, facing, height = 220, attacking = false, reeling = false,
}: {
  design: FighterDesign
  party: 'democrat' | 'republican'
  pose: FighterPose
  facing: 'right' | 'left'
  height?: number
  attacking?: boolean
  reeling?: boolean
}) {
  useEffect(() => {
    if (document.getElementById('fighter-sprite-kf')) return
    const s = document.createElement('style')
    s.id = 'fighter-sprite-kf'
    s.textContent = `
      @keyframes sprIdle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
      @keyframes sprJump { 0%{transform:translateY(0)} 40%{transform:translateY(-46px)} 75%{transform:translateY(-38px)} 100%{transform:translateY(0)} }
      @keyframes sprKo { 0%{transform:translateY(-26px);opacity:1} 55%{transform:translateY(4px)} 75%{transform:translateY(-3px)} 100%{transform:translateY(0)} }
      @keyframes sprSpecial { 0%,100%{filter:none} 40%{filter:brightness(1.35) drop-shadow(0 0 18px rgba(255,120,60,0.8))} }
    `
    document.head.appendChild(s)
  }, [])

  const tone = design.toneShift === -1
    ? 'brightness(1.12) saturate(0.94)'
    : design.toneShift === 1
      ? 'brightness(0.82) saturate(1.06)'
      : 'none'

  const anim =
    pose === 'ko' ? 'sprKo 0.7s cubic-bezier(0.4, 0, 0.6, 1.4) forwards'
    : pose === 'jumpkick' ? 'sprJump 0.5s ease-out'
    : pose === 'special' || pose === 'victory' ? 'sprSpecial 0.8s ease-in-out'
    : pose === 'idle' ? 'sprIdle 1.15s ease-in-out infinite'
    : 'none'

  // Sprites face left natively — facing 'right' mirrors them. translateX is
  // applied inside the flip so positive always moves toward the opponent.
  return (
    <div style={{ height, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        style={{
          transform: `scaleX(${facing === 'right' ? -1 : 1}) translateX(${attacking ? -42 : reeling ? 20 : 0}px)`,
          transition: 'transform 150ms cubic-bezier(0.34, 1.4, 0.64, 1)',
        }}
      >
        <div style={{ animation: anim, transformOrigin: 'bottom center' }}>
          <img
            src={spriteUrl(design, party, pose)}
            alt=""
            draggable={false}
            style={{
              height: pose === 'ko' ? height * 0.55 : height,
              width: 'auto',
              maxWidth: 'none',
              filter: tone,
              transform: `scaleX(${BUILD_SCALE[design.body]})`,
              transformOrigin: 'bottom center',
              imageRendering: 'auto',
              userSelect: 'none',
            }}
          />
        </div>
      </div>
    </div>
  )
}

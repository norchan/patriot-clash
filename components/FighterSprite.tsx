'use client'
import { useEffect } from 'react'
import type { FighterDesign } from '@/lib/fighter'
import type { FighterPose } from '@/components/FighterRig'

// Painted fighting-game sprites (public/sprites/{archetype}_{color}_{pose}.webp).
// Sprites are authored facing RIGHT in Republican red (verified against the
// full set — the generator ignored facing instructions but was consistent);
// Democrats load the recolored blue set. Build stretches the sprite, tone
// shift is a filter.

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
      @keyframes sprStrike { 0%{transform:translateX(0) rotate(0deg) scale(1)} 30%{transform:translateX(-14px) rotate(-3deg) scale(1.05)} 100%{transform:translateX(0) rotate(0deg) scale(1)} }
      @keyframes sprJolt { 0%{transform:translateX(0) rotate(0deg)} 35%{transform:translateX(14px) rotate(5deg)} 100%{transform:translateX(0) rotate(0deg)} }
    `
    document.head.appendChild(s)
  }, [])

  const tone = design.toneShift === -1
    ? 'brightness(1.12) saturate(0.94)'
    : design.toneShift === 1
      ? 'brightness(0.82) saturate(1.06)'
      : 'none'

  const attackPoses: FighterPose[] = ['jab', 'cross', 'hook', 'uppercut', 'kick']
  const anim =
    pose === 'ko' ? 'sprKo 0.7s cubic-bezier(0.4, 0, 0.6, 1.4) forwards'
    : pose === 'jumpkick' ? 'sprJump 0.5s ease-out'
    : pose === 'special' || pose === 'victory' ? 'sprSpecial 0.8s ease-in-out'
    : pose === 'hit' || pose === 'dodge' ? 'sprJolt 0.32s ease-out'
    : attackPoses.includes(pose) ? 'sprStrike 0.3s ease-out'
    : pose === 'idle' ? 'sprIdle 1.15s ease-in-out infinite'
    : 'none'

  // Per-pose fit keeps the CHARACTER the same size on screen even though each
  // trimmed image has a different bounding box: the special's aura and the
  // airborne jump kick would otherwise rescale the fighter.
  const sizeStyle: React.CSSProperties =
    pose === 'ko'
      ? { width: height * 1.02, height: 'auto' } // lying body length ≈ standing height
      : pose === 'jumpkick'
        ? { height: height * 0.86, width: 'auto' }
        : pose === 'special' || pose === 'victory'
          ? { height: height * 1.16, width: 'auto' }
          : { height, width: 'auto' }

  // Sprites face RIGHT natively — facing 'left' mirrors them. translateX is
  // applied inside the flip so negative always moves toward the opponent.
  return (
    <div style={{ height, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        style={{
          transform: `scaleX(${facing === 'left' ? -1 : 1}) translateX(${attacking ? 42 : reeling ? -20 : 0}px)`,
          transition: 'transform 150ms cubic-bezier(0.34, 1.4, 0.64, 1)',
        }}
      >
        <div key={pose} style={{ animation: anim, transformOrigin: 'bottom center' }}>
          <img
            src={spriteUrl(design, party, pose)}
            alt=""
            draggable={false}
            style={{
              ...sizeStyle,
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

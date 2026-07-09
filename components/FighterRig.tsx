'use client'
import { useEffect } from 'react'
import type { FighterDesign } from '@/lib/fighter'

// Procedural 2D street fighter v2: jointed SVG rig with tapered limbs, joint
// caps, facial expressions, idle bounce, and a choreographed KO fall.

export type FighterPose =
  | 'idle' | 'jab' | 'cross' | 'hook' | 'uppercut' | 'kick'
  | 'jumpkick' | 'special'
  | 'block' | 'hit' | 'dodge' | 'ko' | 'victory'

interface Joints {
  torso: number
  headY: number
  luA: number; llA: number
  ruA: number; rlA: number
  luL: number; llL: number
  ruL: number; rlL: number
  lift: number
}

// 0 = limb straight down; positive rotates toward the opponent (+x).
const POSES: Record<FighterPose, Joints> = {
  // guard: knees bent, fists up, weight on back foot
  idle:    { torso: 6,  headY: 1, luA: 68, llA: -118, ruA: 48, rlA: -128, luL: 16, llL: -14, ruL: -18, rlL: 20, lift: 3 },
  jab:     { torso: 12, headY: 0, luA: 94, llA: -6,  ruA: 50, rlA: -125, luL: 22, llL: -10, ruL: -20, rlL: 18, lift: 1 },
  cross:   { torso: 22, headY: 0, luA: 55, llA: -115, ruA: 98, rlA: -8,  luL: 26, llL: -6,  ruL: -26, rlL: 22, lift: 1 },
  hook:    { torso: 16, headY: 0, luA: 105, llA: -74, ruA: 42, rlA: -118, luL: 20, llL: -8, ruL: -20, rlL: 16, lift: 0 },
  uppercut:{ torso: 6,  headY: 0, luA: 38, llA: -155, ruA: 36, rlA: -112, luL: 24, llL: -14, ruL: -18, rlL: 14, lift: -6 },
  kick:    { torso: -18, headY: 0, luA: 66, llA: -88, ruA: 24, rlA: -78,  luL: 88, llL: -12, ruL: -22, rlL: 28, lift: -2 },
  jumpkick:{ torso: -24, headY: 0, luA: 70, llA: -92, ruA: 20, rlA: -70,  luL: 96, llL: -8,  ruL: -30, rlL: 40, lift: -18 },
  special: { torso: 8,   headY: -1, luA: 30, llA: -160, ruA: 40, rlA: -110, luL: 26, llL: -12, ruL: -20, rlL: 16, lift: -8 },
  block:   { torso: -2, headY: 3, luA: 122, llA: -142, ruA: 112, rlA: -152, luL: 12, llL: -10, ruL: -14, rlL: 14, lift: 4 },
  hit:     { torso: -24, headY: 4, luA: 34, llA: -66, ruA: 18, rlA: -54,  luL: 8,  llL: -18, ruL: -12, rlL: 24, lift: 4 },
  dodge:   { torso: -30, headY: 5, luA: 56, llA: -108, ruA: 34, rlA: -118, luL: 4, llL: -24, ruL: -8,  rlL: 32, lift: 7 },
  ko:      { torso: 0,  headY: 0, luA: 24, llA: -22, ruA: -24, rlA: -12,  luL: 12, llL: -12, ruL: -8,  rlL: 8,  lift: 0 },
  victory: { torso: 0,  headY: -3, luA: 172, llA: -12, ruA: 166, rlA: -18, luL: 10, llL: -6, ruL: -10, rlL: 8, lift: 0 },
}

const BODY_DIMS = {
  skinny:   { torsoW: 24, limb: 7,  belly: 0 },
  average:  { torsoW: 32, limb: 9,  belly: 4 },
  athletic: { torsoW: 42, limb: 12, belly: 0 },
  fat:      { torsoW: 42, limb: 10, belly: 18 },
}

type ExpKind = 'neutral' | 'angry' | 'pain' | 'happy' | 'out'
const POSE_EXP: Record<FighterPose, ExpKind> = {
  idle: 'neutral', block: 'neutral', dodge: 'neutral',
  jab: 'angry', cross: 'angry', hook: 'angry', uppercut: 'angry', kick: 'angry',
  jumpkick: 'angry', special: 'angry',
  hit: 'pain', ko: 'out', victory: 'happy',
}

export default function FighterRig({
  design, pose, facing, height = 220, attacking = false, reeling = false,
}: {
  design: FighterDesign
  pose: FighterPose
  facing: 'right' | 'left'
  height?: number
  attacking?: boolean
  reeling?: boolean
}) {
  // Inject rig keyframes once
  useEffect(() => {
    if (document.getElementById('fighter-rig-kf')) return
    const s = document.createElement('style')
    s.id = 'fighter-rig-kf'
    s.textContent = `
      @keyframes rigIdle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
      @keyframes rigVictory { 0%,100%{transform:translateY(0)} 30%{transform:translateY(-14px)} 60%{transform:translateY(0)} 80%{transform:translateY(-7px)} }
      @keyframes rigKoFall {
        0%   { transform: translateY(0) rotate(0deg); }
        18%  { transform: translateY(0) rotate(7deg); }
        38%  { transform: translateY(0) rotate(-10deg); }
        56%  { transform: translateY(2px) rotate(4deg); }
        100% { transform: translateY(46px) rotate(-86deg); }
      }
    `
    document.head.appendChild(s)
  }, [])

  const p = POSES[pose]
  const dims = BODY_DIMS[design.body]
  const skin = design.skin
  const limb = dims.limb
  const t = 'transform 140ms cubic-bezier(0.34, 1.3, 0.64, 1)'

  const cx = 80
  const shoulderY = 96
  const hipY = 152
  const torsoW = dims.torsoW
  const headR = 17
  const headCy = shoulderY - 6 - headR + 2

  const armLen = 34, foreLen = 30, legLen = 38, shinLen = 36

  const shade = 'rgba(0,0,0,0.18)'
  const sleeve = design.topStyle === 'tank' ? skin : design.topColor
  const foreColor = design.topStyle === 'hoodie' ? design.topColor : skin

  const Limb = ({ x, y, upper, lower, thick, front }: {
    x: number; y: number; upper: number; lower: number; thick: number; front: boolean
  }) => (
    <g style={{ transform: `rotate(${upper}deg)`, transformOrigin: `${x}px ${y}px`, transition: t }}>
      {/* upper arm (tapered: thicker at shoulder) */}
      <path d={`M ${x - thick / 2} ${y} L ${x + thick / 2} ${y} L ${x + thick / 2 - 1.5} ${y + armLen} L ${x - thick / 2 + 1.5} ${y + armLen} Z`}
        fill={sleeve} />
      <circle cx={x} cy={y} r={thick / 2 + 1} fill={sleeve} />
      <g style={{ transform: `rotate(${lower}deg)`, transformOrigin: `${x}px ${y + armLen - 2}px`, transition: t }}>
        {/* elbow cap */}
        <circle cx={x} cy={y + armLen - 2} r={thick / 2} fill={foreColor} />
        {/* forearm (tapers to wrist) */}
        <path d={`M ${x - thick / 2 + 1} ${y + armLen - 2} L ${x + thick / 2 - 1} ${y + armLen - 2} L ${x + thick / 2 - 2.5} ${y + armLen + foreLen - 8} L ${x - thick / 2 + 2.5} ${y + armLen + foreLen - 8} Z`}
        fill={foreColor} />
        {/* wrist wrap */}
        <rect x={x - thick / 2 + 1.5} y={y + armLen + foreLen - 12} width={thick - 3} height={5} rx={2} fill="#f3f4f6" />
        {/* fist */}
        <circle cx={x} cy={y + armLen + foreLen - 3} r={thick * 0.8} fill={skin} />
        {front && <circle cx={x + 2} cy={y + armLen + foreLen - 4} r={thick * 0.35} fill={shade} opacity={0.4} />}
      </g>
    </g>
  )

  const Leg = ({ x, upper, lower }: { x: number; upper: number; lower: number }) => (
    <g style={{ transform: `rotate(${upper}deg)`, transformOrigin: `${x}px ${hipY}px`, transition: t }}>
      <circle cx={x} cy={hipY} r={limb / 2 + 2} fill={design.pantColor} />
      {/* thigh */}
      <path d={`M ${x - limb / 2 - 2} ${hipY} L ${x + limb / 2 + 2} ${hipY} L ${x + limb / 2} ${hipY + legLen} L ${x - limb / 2} ${hipY + legLen} Z`}
        fill={design.pantColor} />
      <g style={{ transform: `rotate(${lower}deg)`, transformOrigin: `${x}px ${hipY + legLen - 2}px`, transition: t }}>
        <circle cx={x} cy={hipY + legLen - 2} r={limb / 2 + 0.5} fill={design.pantColor} />
        {/* shin */}
        <path d={`M ${x - limb / 2} ${hipY + legLen - 2} L ${x + limb / 2} ${hipY + legLen - 2} L ${x + limb / 2 - 1.5} ${hipY + legLen + shinLen - 6} L ${x - limb / 2 + 1.5} ${hipY + legLen + shinLen - 6} Z`}
          fill={design.pantColor} />
        {/* shoe with sole */}
        <rect x={x - limb / 2 - 2} y={hipY + legLen + shinLen - 10} width={limb + 12} height={8} rx={4} fill="#1f2937" />
        <rect x={x - limb / 2 - 2} y={hipY + legLen + shinLen - 4} width={limb + 12} height={2.5} rx={1} fill="#e5e7eb" />
      </g>
    </g>
  )

  const exp = POSE_EXP[pose]
  const eyeX = cx + 11, eyeY = headCy - 1
  const Face = () => (
    <>
      {/* ear */}
      <circle cx={cx - 8} cy={headCy + 2} r={4} fill={skin} stroke={shade} strokeWidth={0.8} />
      {exp === 'out' ? (
        <>
          {/* X eye */}
          <path d={`M ${eyeX - 3} ${eyeY - 3} l 6 6 M ${eyeX + 3} ${eyeY - 3} l -6 6`} stroke="#111827" strokeWidth={1.8} strokeLinecap="round" />
          <circle cx={cx + 8} cy={headCy + 9} r={3} fill="#111827" opacity={0.75} />
        </>
      ) : exp === 'happy' ? (
        <>
          <path d={`M ${eyeX - 3.5} ${eyeY} q 3.5 -4 7 0`} stroke="#111827" strokeWidth={1.8} fill="none" strokeLinecap="round" />
          <path d={`M ${cx + 2} ${headCy + 8} q 8 7 15 -1`} stroke="#111827" strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </>
      ) : exp === 'pain' ? (
        <>
          <circle cx={eyeX} cy={eyeY} r={2.6} fill="#111827" />
          <rect x={eyeX - 5.5} y={eyeY - 7.5} width={11} height={2.2} rx={1} fill="#111827" style={{ transform: 'rotate(14deg)', transformOrigin: `${eyeX}px ${eyeY - 6}px` }} />
          <ellipse cx={cx + 9} cy={headCy + 9.5} rx={4} ry={5} fill="#111827" opacity={0.85} />
        </>
      ) : exp === 'angry' ? (
        <>
          <circle cx={eyeX} cy={eyeY} r={2.1} fill="#111827" />
          <rect x={eyeX - 5.5} y={eyeY - 6.5} width={11} height={2.4} rx={1} fill="#111827" style={{ transform: 'rotate(-16deg)', transformOrigin: `${eyeX}px ${eyeY - 5}px` }} />
          {/* gritted teeth */}
          <rect x={cx + 4} y={headCy + 7} width={11} height={4.5} rx={1.5} fill="#f9fafb" stroke="#111827" strokeWidth={1} />
          <path d={`M ${cx + 7.5} ${headCy + 7} v 4.5 M ${cx + 11} ${headCy + 7} v 4.5`} stroke="#111827" strokeWidth={0.8} />
        </>
      ) : (
        <>
          <circle cx={eyeX} cy={eyeY} r={2.1} fill="#111827" />
          <rect x={eyeX - 5} y={eyeY - 6} width={10} height={2.2} rx={1} fill="#111827" opacity={0.75} />
          <path d={`M ${cx + 5} ${headCy + 9} h 9`} stroke="#111827" strokeWidth={2} strokeLinecap="round" />
        </>
      )}
    </>
  )

  const Hair = () => {
    const hc = design.hairColor
    switch (design.hairStyle) {
      case 'short': return <path d={`M ${cx - 13} ${headCy} a ${headR} ${headR} 0 0 1 ${headR * 2} 0 l 0 -6 q -${headR} -13 -${headR * 2} 0 z`} fill={hc} />
      case 'long': return (<><path d={`M ${cx - 13} ${headCy} a ${headR} ${headR} 0 0 1 ${headR * 2} 0 z`} fill={hc} /><path d={`M ${cx - 15} ${headCy - 4} q -4 22 2 36 l 8 -2 q -5 -16 -2 -32 z`} fill={hc} /></>)
      case 'bun': return (<><path d={`M ${cx - 13} ${headCy} a ${headR} ${headR} 0 0 1 ${headR * 2} 0 z`} fill={hc} /><circle cx={cx - 9} cy={headCy - headR + 1} r={7} fill={hc} /></>)
      case 'afro': return <circle cx={cx + 2} cy={headCy - 3} r={headR + 6} fill={hc} />
      case 'ponytail': return (<><path d={`M ${cx - 13} ${headCy} a ${headR} ${headR} 0 0 1 ${headR * 2} 0 z`} fill={hc} /><path d={`M ${cx - 12} ${headCy - 6} q -15 12 -8 32 l 5 -2 q -5 -17 7 -26 z`} fill={hc} /></>)
      default: return null
    }
  }

  // ── Accessories (all live inside the head group so they track headY) ──────
  // Beard renders BEFORE the face so the mouth stays visible; mustache/goatee
  // and eyewear render after; hats render over the hair.
  const Beard = () =>
    design.facialHair === 'beard' ? (
      <path
        d={`M ${cx - 12} ${headCy + 3} a 16 16 0 0 0 32 0 l 0 8 a 16 21 0 0 1 -32 0 z`}
        fill={design.hairColor}
      />
    ) : null

  const FaceFuzz = () => {
    const hc = design.hairColor
    if (design.facialHair === 'mustache')
      return <path d={`M ${cx + 2} ${headCy + 6.5} q 7 -3.5 14 0 q -7 4 -14 0 z`} fill={hc} />
    if (design.facialHair === 'goatee')
      return <ellipse cx={cx + 9} cy={headCy + 14} rx={5} ry={4} fill={hc} />
    return null
  }

  const EyewearSvg = () => {
    if (design.eyewear === 'glasses')
      return (
        <>
          <circle cx={eyeX} cy={eyeY} r={5.5} stroke="#111827" strokeWidth={1.4} fill="rgba(255,255,255,0.14)" />
          <path d={`M ${eyeX - 5.5} ${eyeY} L ${cx - 6} ${headCy + 1}`} stroke="#111827" strokeWidth={1.4} />
        </>
      )
    if (design.eyewear === 'shades')
      return (
        <>
          <rect x={eyeX - 6} y={eyeY - 4.5} width={13} height={8} rx={2.5} fill="#111827" />
          <rect x={eyeX - 4} y={eyeY - 3} width={4} height={2} rx={1} fill="#e5e7eb" opacity={0.5} />
          <path d={`M ${eyeX - 6} ${eyeY - 1} L ${cx - 6} ${headCy + 1}`} stroke="#111827" strokeWidth={1.6} />
        </>
      )
    return null
  }

  const HatSvg = () => {
    if (design.hat === 'cap')
      return (
        <>
          <path d={`M ${cx - 12} ${headCy - 6} a 16 16 0 0 1 32 0 z`} fill={design.topColor} />
          <path d={`M ${cx + 18} ${headCy - 8} q 16 1 14 6 l -14 2 z`} fill={design.topColor} />
          <circle cx={cx + 4} cy={headCy - 20} r={2.5} fill={design.topColor} stroke={shade} strokeWidth={0.8} />
        </>
      )
    if (design.hat === 'beanie')
      return (
        <>
          <path d={`M ${cx - 13} ${headCy - 4} a 17 17 0 0 1 34 0 z`} fill={design.topColor} />
          <rect x={cx - 14} y={headCy - 9} width={36} height={7} rx={3} fill={design.topColor} />
          <rect x={cx - 14} y={headCy - 9} width={36} height={7} rx={3} fill="#ffffff" opacity={0.18} />
        </>
      )
    if (design.hat === 'cowboy')
      return (
        <>
          <ellipse cx={cx + 4} cy={headCy - 9} rx={27} ry={5.5} fill="#7c4a21" />
          <path d={`M ${cx - 8} ${headCy - 10} q -1 -17 12 -17 q 13 0 12 17 z`} fill="#8a5a2b" />
          <rect x={cx - 8} y={headCy - 14} width={24} height={4} fill="#5b3416" />
        </>
      )
    return null
  }

  const bodyAnim =
    pose === 'ko' ? 'rigKoFall 1s cubic-bezier(0.5, 0, 0.75, 0.4) forwards'
    : pose === 'victory' ? 'rigVictory 1s ease-in-out infinite'
    : pose === 'idle' ? 'rigIdle 1.05s ease-in-out infinite'
    : 'none'

  return (
    <svg
      viewBox="0 0 160 240"
      width={height * (160 / 240)}
      height={height}
      style={{
        transform: `scaleX(${facing === 'right' ? 1 : -1}) translateX(${attacking ? 36 : reeling ? -18 : 0}px)`,
        transition: 'transform 150ms cubic-bezier(0.34, 1.4, 0.64, 1)',
        overflow: 'visible',
      }}
    >
      <g style={{
        transform: `translateY(${p.lift}px)`,
        transformOrigin: `${cx}px 226px`,
        transition: t,
        animation: bodyAnim,
      }}>
        {/* rear arm + rear leg behind torso */}
        <Limb x={cx - torsoW / 2 + 4} y={shoulderY} upper={p.ruA} lower={p.rlA} thick={limb} front={false} />
        <Leg x={cx - 9} upper={p.ruL} lower={p.rlL} />

        {/* torso */}
        <g style={{ transform: `rotate(${p.torso}deg)`, transformOrigin: `${cx}px ${hipY}px`, transition: t }}>
          <rect x={cx - torsoW / 2} y={shoulderY - 6} width={torsoW} height={hipY - shoulderY + 10} rx={11} fill={design.topColor} />
          {design.body === 'fat' && (
            <ellipse cx={cx + 5} cy={hipY - 15} rx={torsoW / 2 + dims.belly / 2} ry={27} fill={design.topColor} />
          )}
          {design.body === 'athletic' && (
            <path d={`M ${cx - torsoW / 2} ${shoulderY - 6} q ${torsoW / 2} 10 ${torsoW} 0 l -4 20 q -${torsoW / 2 - 4} 8 -${torsoW - 8} 0 z`} fill={shade} opacity={0.35} />
          )}
          {/* waist shading */}
          <rect x={cx - torsoW / 2} y={hipY - 8} width={torsoW} height={12} rx={6} fill={shade} opacity={0.5} />
          {design.topStyle === 'tank' && (
            <>
              <rect x={cx - torsoW / 2 - 1} y={shoulderY - 7} width={9} height={13} rx={3} fill={skin} />
              <rect x={cx + torsoW / 2 - 8} y={shoulderY - 7} width={9} height={13} rx={3} fill={skin} />
            </>
          )}
          {design.topStyle === 'hoodie' && (
            <path d={`M ${cx - 15} ${shoulderY - 9} q 15 -15 30 0 l -5 9 q -10 -9 -20 0 z`} fill={design.topColor} opacity={0.92} />
          )}

          {/* head */}
          <g style={{ transform: `translateY(${p.headY}px)`, transition: t }}>
            {/* neck */}
            <rect x={cx - 4} y={headCy + headR - 4} width={12} height={10} fill={skin} />
            <circle cx={cx + 4} cy={headCy} r={headR} fill={skin} />
            {/* chin shading */}
            <path d={`M ${cx - 9} ${headCy + 8} q 13 9 26 0 l -2 4 q -11 7 -22 0 z`} fill={shade} opacity={0.35} />
            <Beard />
            <Hair />
            <HatSvg />
            <Face />
            <FaceFuzz />
            <EyewearSvg />
          </g>
        </g>

        {/* lead leg + lead arm in front */}
        <Leg x={cx + 9} upper={p.luL} lower={p.llL} />
        <Limb x={cx + torsoW / 2 - 4} y={shoulderY} upper={p.luA} lower={p.llA} thick={limb + 1.5} front />
      </g>
    </svg>
  )
}

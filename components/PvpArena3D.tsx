'use client'
import { Fragment, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, ContactShadows, useTexture } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { headSideImage, headMeta } from '@/config/heads'
import { fighterMeta } from '@/config/fighters'

// 3D PvP street arena: two rigged bobblehead fighters trading punches in a
// street, ringed by a cheering crowd. Solo mode (one fighter facing camera) is
// used by the fighter picker.

// The fighter catalog lives in config/fighters.ts so API routes can validate
// against it without importing this three.js component. Re-exported here for
// the existing import sites.
export { FIGHTERS, fighterMeta, type FighterMeta } from '@/config/fighters'

const HEAD_SCALE = 1.0 // natural proportions — match the reference guard stills
// Bump when the GLBs are regenerated at the same path, to bust browser/CDN cache
// (v2 = closed-fist rebuild).
// ── fight juice: global hit-stop (freezes all mixers a beat on contact) ──────
let hitStopUntil = 0
export function triggerHitStop(ms: number) { hitStopUntil = Math.max(hitStopUntil, performance.now() + ms) }
// ── camera punch (checklist #3): a decaying push-in on heavy/special/KO.
// Lives INSIDE the follow-cam so there's exactly one camera system.
let camKick = 0
export function triggerCamKick(strength: number) { camKick = Math.min(1.2, Math.max(camKick, strength)) }

// Shared comic WINCE decal — bold enough to read over any bobble head at phone size.
// Drawn once as a canvas texture (no per-head art required).
let winceTex: THREE.CanvasTexture | null = null
function getWinceTexture(): THREE.CanvasTexture {
  if (winceTex) return winceTex
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 256
  const ctx = cv.getContext('2d')!
  // soft red flush so the face "takes the hit"
  const g = ctx.createRadialGradient(128, 128, 20, 128, 140, 130)
  g.addColorStop(0, 'rgba(255,60,40,0.55)')
  g.addColorStop(0.55, 'rgba(255,40,30,0.2)')
  g.addColorStop(1, 'rgba(255,40,30,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const stroke2 = (draw: () => void) => {
    // white outline then black — reads on light and dark faces
    for (const [w, c] of [[18, 'rgba(255,255,255,0.95)'], [9, '#0f0f0f']] as [number, string][]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); draw(); ctx.stroke()
    }
  }
  // squeezed eyes: >  <
  stroke2(() => { ctx.moveTo(52, 88); ctx.lineTo(100, 108); ctx.lineTo(52, 128) })
  stroke2(() => { ctx.moveTo(204, 88); ctx.lineTo(156, 108); ctx.lineTo(204, 128) })
  // angry brows
  stroke2(() => { ctx.moveTo(48, 72); ctx.lineTo(108, 82) })
  stroke2(() => { ctx.moveTo(208, 72); ctx.lineTo(148, 82) })
  // gritted zigzag mouth
  stroke2(() => {
    ctx.moveTo(78, 178)
    for (let i = 0; i < 6; i++) ctx.lineTo(78 + (i + 1) * 16, 178 + (i % 2 === 0 ? -12 : 12))
  })
  // impact stars
  ctx.fillStyle = '#fde047'
  for (const [sx, sy] of [[36, 48], [220, 52], [40, 190], [216, 188]] as [number, number][]) {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
      const r = i % 2 === 0 ? 10 : 4
      const x = sx + Math.cos(a) * r, y = sy + Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath(); ctx.fill()
  }
  winceTex = new THREE.CanvasTexture(cv)
  winceTex.needsUpdate = true
  return winceTex
}

const MODEL_VER = 4 // v4: six per-clip GLBs merged into one <prefix>.glb (named clips)

// Correction for the model's front axis (these Meshy models' front is local -X).
// Fighters always aim at their target; change by ±PI/2 if they don't face it.
const FRONT_FIX = Math.PI / 2
// rotation.y so the fighter at (px,pz) faces the point (tx,tz)
const faceToward = (px: number, pz: number, tx: number, tz: number) => Math.atan2(tx - px, tz - pz) + FRONT_FIX

// ── Swappable HEAD: a PROFILE cutout locked to the body's facing ─────────────
// The body's own head is hidden (bone squashed) and the chosen caricature head
// rides the Head bone as a textured plane. The art is a SIDE-view render, and
// the plane is body-locked (rotY cancels the fighter's facing so the plane
// stays screen-parallel) — the player's head looks RIGHT at the opponent, and
// the mirrored foe's flips to look left. Not a camera billboard.
const WINCE_MS = 380 // longer read on phone

function ProfileHead({ headId, faceY, duck = false, mirror = false, hitKey = 0, getHeadBone }: { headId: string; faceY: number; duck?: boolean; mirror?: boolean; hitKey?: number; getHeadBone: () => THREE.Object3D | null }) {
  const tex = useTexture(headSideImage(headId))
  const meta = headMeta(headId)
  const ref = useRef<THREE.Mesh>(null!)
  const winceRef = useRef<THREE.Mesh>(null!)
  const flashRef = useRef<THREE.Mesh>(null!)
  const matRef = useRef<THREE.MeshBasicMaterial>(null!)
  const winceAt = useRef(0)
  useEffect(() => { if (hitKey) winceAt.current = performance.now() }, [hitKey])
  const v = useMemo(() => new THREE.Vector3(), [])
  const dy = 0.36 + (meta?.dy ?? 0) // small bump up (Michael) — jaw clears the shoulder line
  useFrame(() => {
    const bone = getHeadBone()
    if (!bone || !ref.current?.parent) return
    bone.getWorldPosition(v)
    v.y += dy // head center sits a bit above the neck joint
    // idle bobble energy on swapped heads (clamped sine — no accumulation)
    const clock = performance.now() / 1000
    v.y += Math.sin(clock * 2.9) * 0.012
    ref.current.parent.worldToLocal(v)
    ref.current.position.copy(v)
    // WINCE: squash-and-bounce + face decal + white flash + slight recoil tilt
    const t = performance.now() - winceAt.current
    const active = t >= 0 && t < WINCE_MS
    const k = active ? Math.sin((t / WINCE_MS) * Math.PI) : 0 // 0→1→0
    const idleTilt = Math.sin(clock * 2.4) * 0.04
    const tilt = active ? (mirror ? 1 : -1) * 0.2 * k : idleTilt
    ref.current.scale.set(baseSX * (1 + 0.22 * k), baseSY * (1 - 0.32 * k), 1)
    ref.current.rotation.z = tilt
    // red-ish flash on the head texture itself
    if (matRef.current) {
      const flash = active ? 0.35 + 0.65 * Math.sin((t / WINCE_MS) * Math.PI) : 0
      matRef.current.color.setRGB(1, 1 - flash * 0.55, 1 - flash * 0.55)
    }
    if (winceRef.current) {
      winceRef.current.visible = active
      winceRef.current.position.copy(v)
      winceRef.current.position.z += 0.025
      winceRef.current.rotation.z = tilt
      winceRef.current.scale.set(baseSX * (1 + 0.22 * k) * 0.88, baseSY * (1 - 0.32 * k) * 0.88, 1)
    }
    if (flashRef.current) {
      // brief white impact ring behind the head
      const f = active && t < 90 ? 1 - t / 90 : 0
      flashRef.current.visible = f > 0
      flashRef.current.position.copy(v)
      flashRef.current.position.z -= 0.01
      const fs = 1.15 + (1 - f) * 0.55
      flashRef.current.scale.set(baseSX * fs, baseSY * fs, 1)
      const fm = flashRef.current.material as THREE.MeshBasicMaterial
      fm.opacity = 0.55 * f
    }
  })
  const img = tex.image as { width?: number; height?: number } | undefined
  const aspect = img?.width && img?.height ? img.width / img.height : 1
  const H = 0.85 * (meta?.scale ?? 1) // full head to the jaw line — no clothing
  // the crouch squashes the parent group — un-squash the head so the bobble
  // keeps its proportions while the body ducks
  const yFix = duck ? 1 / 0.82 : 1
  const baseSX = H * aspect, baseSY = H * yFix
  const rotY = mirror ? faceY : -faceY
  return (
    <>
      <mesh ref={flashRef} rotation={[0, rotY, 0]} visible={false}>
        <circleGeometry args={[0.55, 24]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ref} rotation={[0, rotY, 0]} scale={[baseSX, baseSY, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={matRef} map={tex} transparent alphaTest={0.3} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={winceRef} rotation={[0, rotY, 0]} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={getWinceTexture()} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  )
}

function Fighter({ prefix, x, y = 0, duck = false, faceY, mirror = false, headId, blocking = false, jabRKey = 0, jabLKey = 0, kickHiKey = 0, kickLoKey = 0, hitKey = 0, spinKey = 0, sweepKey = 0, down = false, win = false }:
  { prefix: string; x: number; y?: number; duck?: boolean; faceY: number; mirror?: boolean; headId?: string | null; blocking?: boolean; jabRKey?: number; jabLKey?: number; kickHiKey?: number; kickLoKey?: number; hitKey?: number; spinKey?: number; sweepKey?: number; down?: boolean; win?: boolean }) {
  // Real boxing kit. The Left_Jab clip starts AND ends in a proper fists-up
  // boxing guard, so its frame 0 doubles as the held GUARD (fists at the face).
  // One-shots: straight punch (right), the jab (left), a straight KICK
  // (Boxing_Guard_Right_Straight_Kick), and a hit reaction.
  // LEG KICK: play the clip as-authored (no extra body yaw — runtime turns
  // faced the wrong way on phone; real roundhouse needs a proper clip later).
  // ONE file per fighter, six NAMED clips inside (scripts/merge_fighter_clips.mjs).
  // Was six separate GLBs, each carrying a duplicate copy of the same mesh +
  // texture — 7.8 MB per fighter vs ~1.5 MB now, and one fetch instead of six.
  const gltf = useGLTF(`/models/${prefix}.glb?v=${MODEL_VER}`)
  const scene = gltf.scene
  const clip = (name: string) => gltf.animations.find(a => a.name === name) ?? null
  // SPIN KICK (Michael 2026-07-28): hold BACK + head kick. Bumping spinKey
  // spins the whole fighter a full 360° about Y over the kick, then lands back
  // on its facing — a recognisable spinning jump kick built from the head-kick
  // clip we already know reads well. (A full turn, unlike the old half-turn
  // leg-kick experiment that left fighters facing the camera.)
  // LEG SWEEP (Michael 2026-07-29): hold DOWN + low kick. Same trick as the
  // spin kick — no new animation credits. It's the SAME 360° turn, but taken
  // from a deep crouch, which is what sells it as a sweep rather than a spin:
  // the turn happens down at shin height where the low clip's leg already is.
  // Faster than the spin (a sweep is a snap, not a wind-up).
  const spinGroup = useRef<THREE.Group>(null!)
  const spinAt = useRef(0)
  const sweepAt = useRef(0)
  const downAt = useRef(0)
  useEffect(() => { if (spinKey) spinAt.current = performance.now() }, [spinKey])
  useEffect(() => { if (sweepKey) sweepAt.current = performance.now() }, [sweepKey])
  // KO FALL (checklist #3): no fall clip exists in the merged GLBs, so the
  // fighter tips over about its FEET (group origin) like a 2D-fighter KO —
  // eased, held until `down` clears. Winner celebrates with a hop loop.
  useEffect(() => { if (down) downAt.current = performance.now() }, [down])
  useFrame(() => {
    if (!spinGroup.current) return
    const now = performance.now()
    const SPIN_MS = 560, SWEEP_MS = 460
    const t = now - spinAt.current
    const spinning = spinAt.current > 0 && t >= 0 && t < SPIN_MS
    const st = now - sweepAt.current
    const sweeping = sweepAt.current > 0 && st >= 0 && st < SWEEP_MS
    // ease-out so the turn snaps early and settles cleanly on the facing
    const turn = sweeping ? 1 - Math.pow(1 - st / SWEEP_MS, 2.6)
      : spinning ? 1 - Math.pow(1 - t / SPIN_MS, 2.2)
      : 0
    spinGroup.current.rotation.y = faceY + (mirror ? -1 : 1) * turn * Math.PI * 2
    // Drop into the crouch and back out across the turn (0 → 1 → 0). Written
    // here rather than in JSX because useFrame runs after render — the same
    // reason rotation.y is set here and not on the element.
    const crouch = sweeping ? Math.sin(Math.PI * (st / SWEEP_MS)) : 0
    spinGroup.current.scale.y = (duck ? 0.82 : 1) * (1 - 0.36 * crouch)
    // KO fall: tip backward (away from the opponent) over 650ms with a tiny
    // settle bounce; victory: readable hop loop. Both override cleanly.
    if (down) {
      const ft = Math.min(1, (now - downAt.current) / 650)
      const e = 1 - Math.pow(1 - ft, 3)
      const settle = ft >= 1 ? 0 : Math.sin(ft * Math.PI * 2) * 0.04 * (1 - ft)
      spinGroup.current.rotation.z = (mirror ? -1 : 1) * (1.38 * e + settle)
      spinGroup.current.position.y = y
    } else {
      spinGroup.current.rotation.z = 0
      spinGroup.current.position.y = win ? y + Math.abs(Math.sin(now / 1000 * 5.4)) * 0.16 : y
    }
  })
  const fit = useRef<THREE.Group>(null!)
  const head = useMemo(() => scene.getObjectByName('Head') ?? null, [scene])
  const hips = useMemo(() => scene.getObjectByName('Hips') ?? null, [scene])
  // These Meshy meshes have OPEN flat hands baked in (no finger bones — the
  // t-pose conversion discards the fist art). Squash the hand bones every frame
  // (short along the fingers, chunkier across) so they read as closed FISTS.
  // NOTE: these rigs name the bone lowercase 'neck' — the capitalized lookup
  // silently returned null forever (why neck-hiding never worked)
  const neck = useMemo(() => scene.getObjectByName('Neck') ?? scene.getObjectByName('neck') ?? null, [scene])
  const handL = useMemo(() => scene.getObjectByName('LeftHand') ?? null, [scene])
  const handR = useMemo(() => scene.getObjectByName('RightHand') ?? null, [scene])
  const hips0 = useRef<THREE.Vector3 | null>(null)

  const { mixer, guard, guardHold, block, shots } = useMemo(() => {
    const m = new THREE.AnimationMixer(scene)
    // guard = a CLONE of the jab clip frozen at its guard frame (fists up at face)
    const guardClip = clip('jabL')?.clone()
    const gd = guardClip ? m.clipAction(guardClip) : null
    const guardHold = 0.03
    if (gd) { gd.play(); gd.paused = true; gd.time = guardHold; gd.setEffectiveWeight(1) }
    // Meshy's boxing clips have a LONG guard lead-in before the actual strike
    // (the 210 straight doesn't punch until ~1.5-2.2s of a 4s clip!). Play each
    // one-shot from `skipIn` at `speed` so the strike is VISIBLE within ~150-250ms
    // of the button press — otherwise rapid taps reset the clip before the punch
    // ever shows and the fighter looks frozen in guard.
    const oneShot = (name: string, skipIn: number, speed: number) => {
      const c = clip(name)
      const a = c ? m.clipAction(c) : null
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      return a ? { a, skipIn, speed } : null
    }
    // BLOCK = a held forearms-up cover pose (Block1 clip frozen mid-cover)
    const blockClip = clip('block')
    const blk = blockClip ? m.clipAction(blockClip) : null
    if (blk) { blk.play(); blk.paused = true; blk.time = 1.2; blk.setEffectiveWeight(0) }
    return {
      mixer: m, guard: gd, guardHold, block: blk,
      shots: {
        jabR: oneShot('punch', 1.45, 2.4), // straight: strike at ~2.0s in the raw clip
        jabL: oneShot('jabL', 0.26, 1.9),  // jab: extension ~0.5s in the raw clip
        // HEAD KICK: Step_in_High_Kick (218) — leg extended head-height at ~0.56s
        kickHi: oneShot('kickhi', 0.2, 1.4),
        // KNEE (2026-07-28): the Simple_Kick clip is not a kick at all — the
        // harness shows the thigh lifting with the shin tucked under and the
        // foot never extending. That is a KNEE, which is why every attempt to
        // aim it as a leg kick looked wrong. Play it as what it is: enter at
        // 0.65 and land the strike at its peak (clip ~0.9, knee at body height)
        //   0.65 + 0.155 * 1.6 ≈ 0.90
        kickLo: oneShot('kicklo', 0.65, 1.6),
        hit: oneShot('hit', 0.12, 1.6),
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gltf.animations])

  useLayoutEffect(() => {
    // The GLTF scene is CACHED across mounts — reset every mutation we may have
    // left on it (bone scales, aim tilt) so the fit is measured clean, then
    // apply the guard pose BEFORE measuring so the fighter is grounded by its
    // actual stance.
    scene.traverse(o => { if ((o as any).isBone) o.scale.setScalar(1) })
    if (fit.current) fit.current.rotation.set(0, 0, 0)
    mixer.update(0.0001)
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    // Height is per-fighter: 2.2 is the standard. Trimming ALL sprite fighters
    // made them look stunted (Michael) — only genuinely wide rigs get a trim,
    // set via fitHeight in config/fighters.ts.
    const meta = fighterMeta(prefix.replace(/_(rep|dem)$/, ''))
    const targetH = meta?.fitHeight ?? 2.2
    const s = targetH / (size.y || 1) // feet stay planted, expand up
    if (fit.current) {
      fit.current.scale.setScalar(s)
      fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s)
      // Anchor HORIZONTALLY on the hips, not the bounding-box centre. A long
      // coat or a backpack skews the bbox and shoved the whole body off its
      // mark (measured ~1.1 units) — which is why fighters drifted right and
      // overlapped. Y is left alone so feet stay on the ground.
      if (hips && fit.current.parent) {
        // updateWorldMatrix(true,…) refreshes the ANCESTOR chain — plain
        // updateMatrixWorld leaves the parent stale and the correction no-ops
        hips.updateWorldMatrix(true, false)
        const hp = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld)
        const local = fit.current.parent.worldToLocal(hp)
        fit.current.position.x -= local.x
        fit.current.position.z -= local.z
      }
    }
    if (hips) hips0.current = hips.position.clone()
  }, [scene, hips, mixer, prefix])

  // Only ONE move plays at a time. A new move first CANCELS any in-progress move
  // (otherwise two clips blend and the fighter never returns cleanly to guard),
  // then snaps in over the held guard. `active` tracks the latest move so the
  // guard is only restored when that exact move finishes (nothing newer started).
  type Shot = { a: THREE.AnimationAction; skipIn: number; speed: number }
  const active = useRef<THREE.AnimationAction | null>(null)
  const restoreGuard = () => {
    if (guard) { guard.time = guardHold; guard.paused = true; guard.setEffectiveWeight(1) }
  }
  const playShot = (s: Shot | null) => {
    if (!s) return
    for (const o of [shots.jabR, shots.jabL, shots.kickHi, shots.kickLo, shots.hit]) {
      if (o && o.a !== s.a) { o.a.stop(); o.a.setEffectiveWeight(0) }
    }
    guard?.setEffectiveWeight(0)
    s.a.reset()
    s.a.time = s.skipIn                    // jump past the guard lead-in
    s.a.setEffectiveTimeScale(s.speed)     // snappy strike, not slow mocap
    s.a.setEffectiveWeight(1)
    s.a.play()
    active.current = s.a
  }
  useEffect(() => {
    const onFin = (e: any) => {
      if (e.action === shots.jabR?.a || e.action === shots.jabL?.a || e.action === shots.kickHi?.a || e.action === shots.kickLo?.a || e.action === shots.hit?.a) {
        e.action.setEffectiveWeight(0); e.action.stop()
        // only fall back to guard if this was the most recent move
        if (active.current === e.action) { active.current = null; restoreGuard() }
      }
    }
    mixer.addEventListener('finished', onFin)
    return () => mixer.removeEventListener('finished', onFin)
  }, [mixer, shots, guard, guardHold]) // eslint-disable-line react-hooks/exhaustive-deps
  // BLOCK visual: holding block swaps the held guard for the forearms-up cover
  useEffect(() => {
    if (!guard || !block) return
    if (blocking) {
      for (const o of [shots.jabR, shots.jabL, shots.kickHi, shots.kickLo, shots.hit]) { if (o) { o.a.stop(); o.a.setEffectiveWeight(0) } }
      active.current = null
      guard.setEffectiveWeight(0)
      block.time = 1.2; block.paused = true; block.setEffectiveWeight(1)
    } else {
      block.setEffectiveWeight(0)
      if (!active.current) restoreGuard()
    }
  }, [blocking]) // eslint-disable-line react-hooks/exhaustive-deps
  const pR = useRef(0), pL = useRef(0), pKH = useRef(0), pKL = useRef(0), pH = useRef(0)
  useEffect(() => { if (jabRKey > pR.current) { pR.current = jabRKey; playShot(shots.jabR) } }, [jabRKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jabLKey > pL.current) { pL.current = jabLKey; playShot(shots.jabL) } }, [jabLKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickHiKey > pKH.current) { pKH.current = kickHiKey; playShot(shots.kickHi) } }, [kickHiKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickLoKey > pKL.current) { pKL.current = kickLoKey; playShot(shots.kickLo) } }, [kickLoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hitKey > pH.current) { pH.current = hitKey; playShot(shots.hit) } }, [hitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // BOBBLE: clamped oscillation layered on the head bone. Anti-accumulation
  // guard: if the mixer did NOT overwrite the head quaternion this frame (clip
  // without a head track), the quaternion still equals our last post-bobble
  // value — restore the pre-bobble pose first, so the wobble can never
  // compound into the old tumble-into-torso bug.
  const headPre = useRef(new THREE.Quaternion())
  const headPost = useRef(new THREE.Quaternion())
  const bobbleQ = useRef(new THREE.Quaternion())
  const bobbleE = useRef(new THREE.Euler())
  useFrame((state, dt) => {
    if (performance.now() < hitStopUntil) return // hit-stop: everyone freezes a beat
    mixer.update(dt)
    // PLANT the fighter: strip horizontal root motion so they stay on their
    // side and don't wander/pass through each other (2D-fighter feel)
    if (hips && hips0.current) { hips.position.x = hips0.current.x; hips.position.z = hips0.current.z }
    // Oversized head with readable BOBBLE energy (clamped sine — see guard above).
    // With a swapped head, squash the model's own head so the billboard replaces it.
    if (head) head.scale.setScalar(headId ? 0.001 : HEAD_SCALE)
    if (head && !headId) {
      const t = state.clock.elapsedTime
      if (head.quaternion.equals(headPost.current)) head.quaternion.copy(headPre.current)
      headPre.current.copy(head.quaternion)
      bobbleE.current.set(Math.sin(t * 2.7) * 0.09, 0, Math.cos(t * 2.15) * 0.11)
      bobbleQ.current.setFromEuler(bobbleE.current)
      head.quaternion.multiply(bobbleQ.current)
      headPost.current.copy(head.quaternion)
    }
    if (neck) neck.scale.setScalar(headId ? 0.001 : 1) // swapped head hides the neck too
    // CLOSED FISTS: squash the open-paddle hands into compact fists every frame
    // (short along the fingers, chunkier across) — render-verified at game distance
    if (handL) handL.scale.set(1.2, 0.45, 1.2)
    if (handR) handR.scale.set(1.2, 0.45, 1.2)
  })

  // Opponent (player 2) is MIRRORED across X — like every fighting game — so its
  // asymmetric boxing guard reads correctly instead of turning into an arms-up pose.
  return (
    <group ref={spinGroup} position={[x, y, 0.6]} rotation={[0, faceY, 0]} scale={[mirror ? -1 : 1, duck ? 0.82 : 1, 1]}>
      <group ref={fit}><primitive object={scene} /></group>
      {headId && <ProfileHead headId={headId} faceY={faceY} duck={duck} mirror={mirror} hitKey={hitKey} getHeadBone={() => head} />}
    </group>
  )
}

// ── 3D contact impacts (Phase B of the presentation brief): a comic starburst
// stamped IN THE SCENE at the strike point, so the hit moment lives where the
// fighters are — the DOM damage numbers reinforce it instead of carrying it.
// Textures are drawn once to canvases; sprites come from a fixed pool.
export type ImpactKind = 'light' | 'heavy' | 'special' | 'block'
export interface ImpactEvent { key: number; side: 'player' | 'opp'; kind: ImpactKind }

let impactTexes: { star: THREE.CanvasTexture; ring: THREE.CanvasTexture; block: THREE.CanvasTexture; rays: THREE.CanvasTexture } | null = null
function getImpactTextures() {
  if (impactTexes) return impactTexes
  const make = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement('canvas')
    cv.width = 256; cv.height = 256
    const ctx = cv.getContext('2d')!
    ctx.translate(128, 128)
    draw(ctx)
    const t = new THREE.CanvasTexture(cv)
    t.needsUpdate = true
    return t
  }
  // comic starburst — white core, yellow spikes, orange rim
  const star = make(ctx => {
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 120)
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#fde047')
    g.addColorStop(0.8, '#f97316'); g.addColorStop(1, 'rgba(249,115,22,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    const spikes = 9
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i * Math.PI) / spikes
      const r = i % 2 === 0 ? 118 : 38 + ((i * 37) % 22) // jagged inner radii
      const x = Math.cos(a) * r, y = Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill()
  })
  // expanding shockwave ring (heavy/special only)
  const ring = make(ctx => {
    ctx.strokeStyle = 'rgba(255,240,200,0.9)'; ctx.lineWidth = 10
    ctx.shadowColor = '#fde047'; ctx.shadowBlur = 24
    ctx.beginPath(); ctx.arc(0, 0, 96, 0, Math.PI * 2); ctx.stroke()
  })
  // blue-white CLANG — the guard ate it, visually distinct from a hit
  const block = make(ctx => {
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 110)
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#bfdbfe')
    g.addColorStop(0.85, '#3b82f6'); g.addColorStop(1, 'rgba(59,130,246,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 6
      const x = Math.cos(a) * 100, y = Math.sin(a) * 100
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 7; ctx.lineCap = 'round'
    for (const a of [0.4, 2.2, 3.9, 5.3]) {
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30)
      ctx.lineTo(Math.cos(a) * 88, Math.sin(a) * 88)
      ctx.stroke()
    }
  })
  // anime speed-rays for HEAVY/SPECIAL only — thin additive spokes that sell
  // "this one landed harder" without a particle system (checklist #3)
  const rays = make(ctx => {
    ctx.strokeStyle = 'rgba(255,235,170,0.9)'
    ctx.lineCap = 'round'
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.09
      const r0 = 34 + (i % 4) * 7
      const r1 = 108 + ((i * 29) % 18)
      ctx.lineWidth = i % 2 === 0 ? 5 : 3
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
      ctx.stroke()
    }
  })
  impactTexes = { star, ring, block, rays }
  return impactTexes
}

const IMPACT_POOL = 5
const IMPACT_PARAMS: Record<ImpactKind, { dur: number; star: number; ring: number; rays: number }> = {
  light:   { dur: 260, star: 0.9, ring: 0,   rays: 0 },
  heavy:   { dur: 380, star: 1.5, ring: 2.1, rays: 2.4 },
  special: { dur: 520, star: 2.1, ring: 3.0, rays: 3.4 },
  block:   { dur: 300, star: 1.0, ring: 0,   rays: 0 },
}

function ImpactFX({ impact, playerX, oppX }: { impact?: ImpactEvent; playerX: number; oppX: number }) {
  const texes = useMemo(() => getImpactTextures(), [])
  const slots = useRef(Array.from({ length: IMPACT_POOL }, () => ({ born: -1, kind: 'light' as ImpactKind })))
  const starRefs = useRef<(THREE.Sprite | null)[]>([])
  const ringRefs = useRef<(THREE.Sprite | null)[]>([])
  const rayRefs = useRef<(THREE.Sprite | null)[]>([])
  const lastKey = useRef(0)
  useEffect(() => {
    if (!impact || impact.key === lastKey.current) return
    lastKey.current = impact.key
    const i = impact.key % IMPACT_POOL
    const s = slots.current[i]
    s.born = performance.now()
    s.kind = impact.kind
    // strike point: the struck fighter's torso/head band, nudged toward the
    // attacker — specials land a touch higher (on the chin)
    const x = impact.side === 'player' ? playerX + 0.32 : oppX - 0.32
    const y = (impact.kind === 'block' ? 1.1 : impact.kind === 'special' ? 1.38 : 1.25) + (Math.random() - 0.5) * 0.24
    const star = starRefs.current[i], ring = ringRefs.current[i], rays = rayRefs.current[i]
    if (star) {
      star.position.set(x, y, 1.0)
      const m = star.material as THREE.SpriteMaterial
      m.map = impact.kind === 'block' ? texes.block : texes.star
      m.rotation = impact.kind === 'block' ? 0 : Math.random() * Math.PI * 2
    }
    if (ring) ring.position.set(x, y, 0.98)
    if (rays) {
      rays.position.set(x, y, 0.99)
      ;(rays.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI
    }
  }, [impact]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const now = performance.now()
    for (let i = 0; i < IMPACT_POOL; i++) {
      const s = slots.current[i]
      const star = starRefs.current[i], ring = ringRefs.current[i], rays = rayRefs.current[i]
      if (!star || !ring || !rays) continue
      const P = IMPACT_PARAMS[s.kind]
      const t = s.born < 0 ? Infinity : now - s.born
      if (t > P.dur) { star.visible = false; ring.visible = false; rays.visible = false; continue }
      const p = t / P.dur
      const ease = 1 - (1 - p) * (1 - p)
      star.visible = true
      const sv = P.star * (0.55 + 0.85 * ease)
      star.scale.set(sv, sv, 1)
      ;(star.material as THREE.SpriteMaterial).opacity = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85
      if (P.ring > 0) {
        ring.visible = true
        const rv = P.ring * (0.4 + 1.8 * ease)
        ring.scale.set(rv, rv, 1)
        ;(ring.material as THREE.SpriteMaterial).opacity = (1 - p) * 0.8
      } else ring.visible = false
      if (P.rays > 0) {
        rays.visible = true
        const rr = P.rays * (0.5 + 1.1 * ease)
        rays.scale.set(rr, rr, 1)
        const rm = rays.material as THREE.SpriteMaterial
        rm.opacity = (1 - p) * 0.85
        rm.rotation += dt * 1.6 // slow twist so the spokes feel alive
      } else rays.visible = false
    }
  })
  return (
    <group>
      {Array.from({ length: IMPACT_POOL }).map((_, i) => (
        <Fragment key={i}>
          {/* depthTest off — the stamp must read over the fighter meshes */}
          <sprite ref={el => { starRefs.current[i] = el }} visible={false} renderOrder={999}>
            <spriteMaterial map={texes.star} transparent depthWrite={false} depthTest={false} />
          </sprite>
          <sprite ref={el => { ringRefs.current[i] = el }} visible={false} renderOrder={998}>
            <spriteMaterial map={texes.ring} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
          </sprite>
          <sprite ref={el => { rayRefs.current[i] = el }} visible={false} renderOrder={997}>
            <spriteMaterial map={texes.rays} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
          </sprite>
        </Fragment>
      ))}
    </group>
  )
}

// ── Ground plane (Phase A of the presentation brief): a real dark-asphalt
// surface the fighters stand ON, so feet + ContactShadows read as grounded
// instead of floating over the backdrop photo. Speckle is drawn once to a
// canvas (no asset download); scene fog fades the far edge into the arena JPG
// so there's no hard horizon line.
let asphaltTex: THREE.CanvasTexture | null = null
function getAsphaltTexture(): THREE.CanvasTexture {
  if (asphaltTex) return asphaltTex
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 256
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#17171c'
  ctx.fillRect(0, 0, 256, 256)
  // aggregate speckle — light + dark grains
  for (let i = 0; i < 1400; i++) {
    const l = Math.random()
    ctx.fillStyle = l < 0.5
      ? `rgba(255,255,255,${0.03 + Math.random() * 0.07})`
      : `rgba(0,0,0,${0.08 + Math.random() * 0.14})`
    const s = Math.random() < 0.92 ? 1 : 2
    ctx.fillRect(Math.random() * 256, Math.random() * 256, s, s)
  }
  asphaltTex = new THREE.CanvasTexture(cv)
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping
  asphaltTex.repeat.set(7, 4)
  asphaltTex.needsUpdate = true
  return asphaltTex
}

function Ground() {
  const tex = useMemo(() => getAsphaltTexture(), [])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0.6]} receiveShadow>
        <planeGeometry args={[34, 18]} />
        <meshStandardMaterial map={tex} color="#8a8a92" roughness={0.96} metalness={0} />
      </mesh>
      {/* faint painted center line where the fighters square off */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0.6]}>
        <planeGeometry args={[0.09, 18]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.07} depthWrite={false} />
      </mesh>
    </group>
  )
}

// ── Cinematic arena backdrop (fills the canvas behind the fighters) ──────────
function Backdrop({ url }: { url: string }) {
  const tex = useTexture(url)
  const { scene, size } = useThree()
  useEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace
    // COVER-crop instead of stretch: scene.background squeezes the JPG to the
    // canvas, which wrecked portrait phones — crop the wide image instead
    const img: any = tex.image
    if (img?.width && img?.height) {
      const canvasAspect = size.width / size.height
      const imageAspect = img.width / img.height
      if (canvasAspect < imageAspect) {
        tex.repeat.set(canvasAspect / imageAspect, 1)
        tex.offset.set((1 - tex.repeat.x) / 2, 0)
      } else {
        tex.repeat.set(1, imageAspect / canvasAspect)
        tex.offset.set(0, (1 - tex.repeat.y) / 2)
      }
    }
    const prev = scene.background
    scene.background = tex
    return () => { scene.background = prev }
  }, [tex, scene, size.width, size.height])
  return null
}


// PORTRAIT follow-cam: classic 2D-fighter framing for the vertical layout —
// tracks the midpoint of the two fighters and zooms with their separation, so
// fighters stay big (builder-preview size) when they close in.
// ── CAMERA CONTRACT (frozen per PVP_PRESENTATION_BRIEF Phase A3) ─────────────
// FOV 48 · z = clamp(3.4 + gap*1.05, 4.5, 7.2) · cam y 1.52 · lookAt y 1.42.
// Do NOT tune these numbers again without Michael explicitly asking.
//
// 2026-07-30 — Michael DID ask ("start the players farther away from each
// other"), and honouring it required one addition, not a retune. The contract
// numbers above are all preserved; a WIDTH FLOOR is layered on top.
//
// Why it was needed: a three.js perspective FOV is VERTICAL. On a portrait
// phone (canvas roughly 390x644, aspect ~0.6) the horizontal view is less than
// two thirds of the vertical one, so the fighters can be comfortably framed
// top-to-bottom while their outer shoulders hang off the sides. At the old
// resting gap they were already grazing that edge — which is very likely part
// of why The Don kept reading as "too big" on mobile: he wasn't just large, he
// was CROPPED. Simply separating the fighters would have pushed them clean off
// screen on a phone while looking perfect on my landscape desktop.
//
// So: pull back far enough that both fighters plus their bodies always fit
// horizontally, and take whichever distance is greater. On a wide screen the
// width floor never binds and the original framing is untouched.
function FollowCam({ playerX, oppX }: { playerX: number; oppX: number }) {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    const c = camera as THREE.PerspectiveCamera
    c.fov = 48; c.updateProjectionMatrix()
  }, [camera])
  useFrame((_, dt) => {
    const mid = (playerX + oppX) / 2
    const gap = Math.abs(oppX - playerX)
    // farther still (Michael round 2) — smaller fighters, full clearance
    const byGap = 3.4 + gap * 1.05
    // Width floor: half-width visible at the fighter plane is
    // (z - 0.6) * tan(fov/2) * aspect, so invert it for the span we need.
    const aspect = size.width / Math.max(1, size.height)
    const halfV = Math.tan((48 / 2) * Math.PI / 180)
    const needHalf = gap / 2 + 0.6            // half the gap + a body + a little air
    const byWidth = 0.6 + needHalf / Math.max(0.2, halfV * aspect)
    const tz = Math.min(9, Math.max(4.5, Math.max(byGap, byWidth)))
    const k = Math.min(1, dt * 6) // smooth chase, no snapping
    camera.position.x += (mid - camera.position.x) * k
    camera.position.z += (tz - camera.position.z) * k
    // view panned UP ~0.4 world units (pure pan, no tilt) → fighters sit
    // about half an inch LOWER on the phone screen (Michael's framing call)
    camera.position.y += (1.52 - camera.position.y) * k
    // camera PUNCH: heavy contact shoves the lens in, then it breathes back
    // out as the kick decays — layered on the contract numbers, never tuned
    // into them (checklist #3)
    if (camKick > 0.01) {
      camera.position.z -= camKick * 0.55
      camKick *= Math.exp(-dt * 8)
    } else camKick = 0
    camera.lookAt(camera.position.x, 1.42, 0)
  })
  return null
}

// Renders null inside the fighters' Suspense boundary — it only mounts once
// every sibling GLB has resolved, so mounting == "both fighters are visible"
function ReadySignal({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.() }, [onReady])
  return null
}

export default function PvpArena3D({ playerPrefix, oppPrefix, playerHeadId, oppHeadId, playerBlocking = false, oppBlocking = false, playerJabRKey = 0, playerJabLKey = 0, oppJabRKey = 0, oppJabLKey = 0, playerKickHiKey = 0, playerKickLoKey = 0, oppKickHiKey = 0, oppKickLoKey = 0, playerHitKey = 0, oppHitKey = 0, playerSpinKey = 0, oppSpinKey = 0, playerSweepKey = 0, oppSweepKey = 0, playerDown = false, oppDown = false, playerWin = false, oppWin = false, solo = false, soloZoom = 1, playerX = -1, playerY = 0, playerDuck = false, oppX = 1, arena = 'foundry', follow = false, impact, playerTint, oppTint, onReady }:
  { playerPrefix: string; oppPrefix?: string; playerHeadId?: string | null; oppHeadId?: string | null; playerBlocking?: boolean; oppBlocking?: boolean; playerJabRKey?: number; playerJabLKey?: number; oppJabRKey?: number; oppJabLKey?: number; playerKickHiKey?: number; playerKickLoKey?: number; oppKickHiKey?: number; oppKickLoKey?: number; playerHitKey?: number; oppHitKey?: number; playerSpinKey?: number; oppSpinKey?: number; playerSweepKey?: number; oppSweepKey?: number; playerDown?: boolean; oppDown?: boolean; playerWin?: boolean; oppWin?: boolean; solo?: boolean; soloZoom?: number; playerX?: number; playerY?: number; playerDuck?: boolean; oppX?: number; arena?: string; follow?: boolean; impact?: ImpactEvent; playerTint?: string; oppTint?: string; onReady?: () => void }) {
  return (
    <Canvas shadows style={{ width: '100%', height: '100%' }}
      camera={{ position: solo ? [0, 1.2, 4.6 * soloZoom] : [0, 1.05, 4.9], fov: solo ? 40 : 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      onCreated={({ camera }) => camera.lookAt(0, solo ? 1.0 : 1.35, 0)}>
      {/* fight mode: fog fades the asphalt's far edge into the backdrop JPG so
          the ground reads as part of the arena, not a floating slab */}
      {!solo && <fog attach="fog" args={['#111116', 9, 22]} />}
      {/* dramatic stage lighting to match the gritty arena */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 4]} intensity={2.4} color="#ffd6a0" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <directionalLight position={[-6, 3, -3]} intensity={1.1} color="#6a8bff" />
      <spotLight position={[0, 7, 6]} angle={0.7} penumbra={0.6} intensity={1.4} color="#ffb877" />
      {/* party corner rim lights (brief Phase C1): each fighter's back edge
          catches their party color — cheap directionals, no extra post stack */}
      {!solo && playerTint && <directionalLight position={[-7, 3, -2]} intensity={1.0} color={playerTint} />}
      {!solo && oppTint && <directionalLight position={[7, 3, -2]} intensity={1.0} color={oppTint} />}
      {follow && !solo && <FollowCam playerX={playerX} oppX={oppX} />}
      <Suspense fallback={null}>
        <Backdrop url={`/arenas/${arena}.jpg`} />
        {solo ? (
          <Fighter key={playerPrefix} prefix={playerPrefix} x={0} faceY={Math.PI / 2} headId={playerHeadId} jabRKey={playerJabRKey} />
        ) : (
          // Classic fighting-game side view: player faces directly right (profile),
          // opponent is a mirror flip facing left. (Model front is local -X, so
          // rotation.y = +PI/2 points the fighter down the +X axis.)
          <>
            <Fighter prefix={playerPrefix} x={playerX} y={playerY} duck={playerDuck} faceY={Math.PI / 2} headId={playerHeadId} blocking={playerBlocking}
              jabRKey={playerJabRKey} jabLKey={playerJabLKey} kickHiKey={playerKickHiKey} kickLoKey={playerKickLoKey} hitKey={playerHitKey} spinKey={playerSpinKey} sweepKey={playerSweepKey}
              down={playerDown} win={playerWin} />
            {oppPrefix && <Fighter prefix={oppPrefix} x={oppX} faceY={-Math.PI / 2} mirror headId={oppHeadId} blocking={oppBlocking}
              jabRKey={oppJabRKey} jabLKey={oppJabLKey} kickHiKey={oppKickHiKey} kickLoKey={oppKickLoKey} hitKey={oppHitKey} spinKey={oppSpinKey} sweepKey={oppSweepKey}
              down={oppDown} win={oppWin} />}
          </>
        )}
        {!solo && <Ground />}
        {!solo && <ImpactFX impact={impact} playerX={playerX} oppX={oppX} />}
        <ContactShadows position={[0, 0.01, 0.6]} opacity={0.65} scale={12} blur={2.6} far={5} color="#000000" />
        <ReadySignal onReady={onReady} />
      </Suspense>
      <EffectComposer>
        <Bloom intensity={0.6} luminanceThreshold={0.7} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.28} darkness={0.8} />
      </EffectComposer>
    </Canvas>
  )
}

'use client'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, ContactShadows, useTexture } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { headSideImage, headMeta } from '@/config/heads'

// 3D PvP street arena: two rigged bobblehead fighters trading punches in a
// street, ringed by a cheering crowd. Solo mode (one fighter facing camera) is
// used by the fighter picker.

export interface FighterMeta { id: string; label: string; img: string; demOnly?: boolean }
export const FIGHTERS: FighterMeta[] = [
  { id: 'fighter1', label: 'Alex', img: '/fighters/fighter1.png' },
  { id: 'fighter2', label: 'Maya', img: '/fighters/fighter2.png' },
  { id: 'fighter3', label: 'Marcus', img: '/fighters/fighter3.png' },
  { id: 'fighter4', label: 'Nina', img: '/fighters/fighter4.png' },
  { id: 'fighter5', label: 'Rainbow', img: '/fighters/fighter5.png' },
  { id: 'fighter6', label: 'Deon', img: '/fighters/fighter6.png' },
]

const HEAD_SCALE = 1.0 // natural proportions — match the reference guard stills
// Bump when the GLBs are regenerated at the same path, to bust browser/CDN cache
// (v2 = closed-fist rebuild).
// ── fight juice: global hit-stop (freezes all mixers a beat on contact) ──────
let hitStopUntil = 0
export function triggerHitStop(ms: number) { hitStopUntil = Math.max(hitStopUntil, performance.now() + ms) }

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

const MODEL_VER = 3 // v3: kicklo swapped to Simple_Kick (103)

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

function Fighter({ prefix, x, y = 0, duck = false, faceY, mirror = false, headId, blocking = false, jabRKey = 0, jabLKey = 0, kickHiKey = 0, kickLoKey = 0, hitKey = 0 }:
  { prefix: string; x: number; y?: number; duck?: boolean; faceY: number; mirror?: boolean; headId?: string | null; blocking?: boolean; jabRKey?: number; jabLKey?: number; kickHiKey?: number; kickLoKey?: number; hitKey?: number }) {
  // Real boxing kit. The Left_Jab clip starts AND ends in a proper fists-up
  // boxing guard, so its frame 0 doubles as the held GUARD (fists at the face).
  // One-shots: straight punch (right), the jab (left), a straight KICK
  // (Boxing_Guard_Right_Straight_Kick), and a hit reaction.
  const punchGltf = useGLTF(`/models/${prefix}_punch.glb?v=${MODEL_VER}`)
  const jabLGltf = useGLTF(`/models/${prefix}_jabL.glb?v=${MODEL_VER}`)
  const kickHiGltf = useGLTF(`/models/${prefix}_kickhi.glb?v=${MODEL_VER}`)
  const kickLoGltf = useGLTF(`/models/${prefix}_kicklo.glb?v=${MODEL_VER}`)
  const blockGltf = useGLTF(`/models/${prefix}_block.glb?v=${MODEL_VER}`)
  const hitGltf = useGLTF(`/models/${prefix}_hit.glb?v=${MODEL_VER}`)
  const scene = jabLGltf.scene
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
    const guardClip = jabLGltf.animations[0]?.clone()
    const gd = guardClip ? m.clipAction(guardClip) : null
    const guardHold = 0.03
    if (gd) { gd.play(); gd.paused = true; gd.time = guardHold; gd.setEffectiveWeight(1) }
    // Meshy's boxing clips have a LONG guard lead-in before the actual strike
    // (the 210 straight doesn't punch until ~1.5-2.2s of a 4s clip!). Play each
    // one-shot from `skipIn` at `speed` so the strike is VISIBLE within ~150-250ms
    // of the button press — otherwise rapid taps reset the clip before the punch
    // ever shows and the fighter looks frozen in guard.
    const oneShot = (g: { animations: THREE.AnimationClip[] }, skipIn: number, speed: number) => {
      const a = g.animations[0] ? m.clipAction(g.animations[0]) : null
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      return a ? { a, skipIn, speed } : null
    }
    // BLOCK = a held forearms-up cover pose (Block1 clip frozen mid-cover)
    const blk = blockGltf.animations[0] ? m.clipAction(blockGltf.animations[0]) : null
    if (blk) { blk.play(); blk.paused = true; blk.time = 1.2; blk.setEffectiveWeight(0) }
    return {
      mixer: m, guard: gd, guardHold, block: blk,
      shots: {
        jabR: oneShot(punchGltf, 1.45, 2.4), // straight: strike at ~2.0s in the raw clip
        jabL: oneShot(jabLGltf, 0.26, 1.9),  // jab: extension ~0.5s in the raw clip
        // HEAD KICK: Step_in_High_Kick (218) — leg extended head-height at ~0.56s
        kickHi: oneShot(kickHiGltf, 0.2, 1.4),
        // LEG KICK: Simple_Kick (103) — thrust kick extends at ~1.0s raw
        kickLo: oneShot(kickLoGltf, 0.62, 2.3), // skip deeper into the wind-up + faster = a snapping leg kick, not a slow push
        hit: oneShot(hitGltf, 0.12, 1.6),
      },
    }
  }, [scene, punchGltf.animations, jabLGltf.animations, kickHiGltf.animations, kickLoGltf.animations, blockGltf.animations, hitGltf.animations])

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
    const s = 2.2 / (size.y || 1) // bigger fighters — feet stay planted, expand up
    if (fit.current) { fit.current.scale.setScalar(s); fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s) }
    if (hips) hips0.current = hips.position.clone()
  }, [scene, hips, mixer])

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
    <group position={[x, y, 0.6]} rotation={[0, faceY, 0]} scale={[mirror ? -1 : 1, duck ? 0.82 : 1, 1]}>
      <group ref={fit}><primitive object={scene} /></group>
      {headId && <ProfileHead headId={headId} faceY={faceY} duck={duck} mirror={mirror} hitKey={hitKey} getHeadBone={() => head} />}
    </group>
  )
}

// ── Cinematic arena backdrop (fills the canvas behind the fighters) ──────────
function Backdrop({ url }: { url: string }) {
  const tex = useTexture(url)
  const { scene } = useThree()
  useEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace
    const prev = scene.background
    scene.background = tex
    return () => { scene.background = prev }
  }, [tex, scene])
  return null
}


// PORTRAIT follow-cam: classic 2D-fighter framing for the vertical layout —
// tracks the midpoint of the two fighters and zooms with their separation, so
// fighters stay big (builder-preview size) when they close in.
function FollowCam({ playerX, oppX }: { playerX: number; oppX: number }) {
  const { camera } = useThree()
  useLayoutEffect(() => {
    const c = camera as THREE.PerspectiveCamera
    c.fov = 48; c.updateProjectionMatrix()
  }, [camera])
  useFrame((_, dt) => {
    const mid = (playerX + oppX) / 2
    const gap = Math.abs(oppX - playerX)
    // farther still (Michael round 2) — smaller fighters, full clearance
    const tz = Math.min(7.2, Math.max(4.5, 3.4 + gap * 1.05))
    const k = Math.min(1, dt * 6) // smooth chase, no snapping
    camera.position.x += (mid - camera.position.x) * k
    camera.position.z += (tz - camera.position.z) * k
    // view panned UP ~0.4 world units (pure pan, no tilt) → fighters sit
    // about half an inch LOWER on the phone screen (Michael's framing call)
    camera.position.y += (1.52 - camera.position.y) * k
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

export default function PvpArena3D({ playerPrefix, oppPrefix, playerHeadId, oppHeadId, playerBlocking = false, oppBlocking = false, playerJabRKey = 0, playerJabLKey = 0, oppJabRKey = 0, oppJabLKey = 0, playerKickHiKey = 0, playerKickLoKey = 0, oppKickHiKey = 0, oppKickLoKey = 0, playerHitKey = 0, oppHitKey = 0, solo = false, playerX = -1, playerY = 0, playerDuck = false, oppX = 1, arena = 'foundry', follow = false, onReady }:
  { playerPrefix: string; oppPrefix?: string; playerHeadId?: string | null; oppHeadId?: string | null; playerBlocking?: boolean; oppBlocking?: boolean; playerJabRKey?: number; playerJabLKey?: number; oppJabRKey?: number; oppJabLKey?: number; playerKickHiKey?: number; playerKickLoKey?: number; oppKickHiKey?: number; oppKickLoKey?: number; playerHitKey?: number; oppHitKey?: number; solo?: boolean; playerX?: number; playerY?: number; playerDuck?: boolean; oppX?: number; arena?: string; follow?: boolean; onReady?: () => void }) {
  return (
    <Canvas shadows style={{ width: '100%', height: '100%' }}
      camera={{ position: solo ? [0, 1.2, 4.6] : [0, 1.05, 4.9], fov: solo ? 40 : 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      onCreated={({ camera }) => camera.lookAt(0, solo ? 1.0 : 1.35, 0)}>
      {/* dramatic stage lighting to match the gritty arena */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 4]} intensity={2.4} color="#ffd6a0" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <directionalLight position={[-6, 3, -3]} intensity={1.1} color="#6a8bff" />
      <spotLight position={[0, 7, 6]} angle={0.7} penumbra={0.6} intensity={1.4} color="#ffb877" />
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
              jabRKey={playerJabRKey} jabLKey={playerJabLKey} kickHiKey={playerKickHiKey} kickLoKey={playerKickLoKey} hitKey={playerHitKey} />
            {oppPrefix && <Fighter prefix={oppPrefix} x={oppX} faceY={-Math.PI / 2} mirror headId={oppHeadId} blocking={oppBlocking}
              jabRKey={oppJabRKey} jabLKey={oppJabLKey} kickHiKey={oppKickHiKey} kickLoKey={oppKickLoKey} hitKey={oppHitKey} />}
          </>
        )}
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

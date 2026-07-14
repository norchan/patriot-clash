'use client'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, ContactShadows, useTexture } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

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
const MODEL_VER = 2

// Correction for the model's front axis (these Meshy models' front is local -X).
// Fighters always aim at their target; change by ±PI/2 if they don't face it.
const FRONT_FIX = Math.PI / 2
// rotation.y so the fighter at (px,pz) faces the point (tx,tz)
const faceToward = (px: number, pz: number, tx: number, tz: number) => Math.atan2(tx - px, tz - pz) + FRONT_FIX

// ── Swappable HEAD: a billboard cutout riding the Head bone ─────────────────
// The body's own head is hidden (bone squashed) and the chosen caricature head
// (transparent PNG from config/heads.ts) tracks the bone every frame.
function BillboardHead({ url, getHeadBone }: { url: string; getHeadBone: () => THREE.Object3D | null }) {
  const tex = useTexture(url)
  const ref = useRef<THREE.Sprite>(null!)
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const bone = getHeadBone()
    if (!bone || !ref.current?.parent) return
    bone.getWorldPosition(v)
    v.y += 0.2 // head center sits a bit above the neck joint
    ref.current.parent.worldToLocal(v)
    ref.current.position.copy(v)
  })
  const img = tex.image as { width?: number; height?: number } | undefined
  const aspect = img?.width && img?.height ? img.width / img.height : 1
  const H = 0.68 // bobble-scale head height in world units
  return (
    <sprite ref={ref} scale={[H * aspect, H, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  )
}

function Fighter({ prefix, x, y = 0, duck = false, faceY, mirror = false, headImg, jabRKey = 0, jabLKey = 0, kickHiKey = 0, kickLoKey = 0, hitKey = 0 }:
  { prefix: string; x: number; y?: number; duck?: boolean; faceY: number; mirror?: boolean; headImg?: string; jabRKey?: number; jabLKey?: number; kickHiKey?: number; kickLoKey?: number; hitKey?: number }) {
  // Real boxing kit. The Left_Jab clip starts AND ends in a proper fists-up
  // boxing guard, so its frame 0 doubles as the held GUARD (fists at the face).
  // One-shots: straight punch (right), the jab (left), a straight KICK
  // (Boxing_Guard_Right_Straight_Kick), and a hit reaction.
  const punchGltf = useGLTF(`/models/${prefix}_punch.glb?v=${MODEL_VER}`)
  const jabLGltf = useGLTF(`/models/${prefix}_jabL.glb?v=${MODEL_VER}`)
  const kickGltf = useGLTF(`/models/${prefix}_kick.glb?v=${MODEL_VER}`)
  const hitGltf = useGLTF(`/models/${prefix}_hit.glb?v=${MODEL_VER}`)
  const scene = jabLGltf.scene
  const fit = useRef<THREE.Group>(null!)
  const head = useMemo(() => scene.getObjectByName('Head') ?? null, [scene])
  const hips = useMemo(() => scene.getObjectByName('Hips') ?? null, [scene])
  // These Meshy meshes have OPEN flat hands baked in (no finger bones — the
  // t-pose conversion discards the fist art). Squash the hand bones every frame
  // (short along the fingers, chunkier across) so they read as closed FISTS.
  const handL = useMemo(() => scene.getObjectByName('LeftHand') ?? null, [scene])
  const handR = useMemo(() => scene.getObjectByName('RightHand') ?? null, [scene])
  const hips0 = useRef<THREE.Vector3 | null>(null)

  const { mixer, guard, guardHold, shots } = useMemo(() => {
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
    return {
      mixer: m, guard: gd, guardHold,
      shots: {
        jabR: oneShot(punchGltf, 1.45, 2.4), // straight: strike at ~2.0s in the raw clip
        jabL: oneShot(jabLGltf, 0.26, 1.9),  // jab: extension ~0.5s in the raw clip
        kick: oneShot(kickGltf, 0.35, 1.6),  // straight kick: extension ~0.75s in the raw clip
        hit: oneShot(hitGltf, 0.12, 1.6),
      },
    }
  }, [scene, punchGltf.animations, jabLGltf.animations, kickGltf.animations, hitGltf.animations])

  useLayoutEffect(() => {
    // Apply the guard pose BEFORE measuring so the fighter is fit + grounded by its
    // actual stance (the guard shifts the feet vs the rest pose — measuring the rest
    // pose made them hover).
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
    for (const o of [shots.jabR, shots.jabL, shots.kick, shots.hit]) {
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
      if (e.action === shots.jabR?.a || e.action === shots.jabL?.a || e.action === shots.kick?.a || e.action === shots.hit?.a) {
        e.action.setEffectiveWeight(0); e.action.stop()
        // only fall back to guard if this was the most recent move
        if (active.current === e.action) { active.current = null; restoreGuard() }
      }
    }
    mixer.addEventListener('finished', onFin)
    return () => mixer.removeEventListener('finished', onFin)
  }, [mixer, shots, guard, guardHold]) // eslint-disable-line react-hooks/exhaustive-deps
  // HEAD vs LEG kick: same clean straight-kick clip, aimed by a brief body
  // tilt — lean back sends the foot HIGH (head), lean forward drops it LOW (legs).
  const aim = useRef({ v: 0, until: 0 })
  const pR = useRef(0), pL = useRef(0), pKH = useRef(0), pKL = useRef(0), pH = useRef(0)
  useEffect(() => { if (jabRKey > pR.current) { pR.current = jabRKey; playShot(shots.jabR) } }, [jabRKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jabLKey > pL.current) { pL.current = jabLKey; playShot(shots.jabL) } }, [jabLKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickHiKey > pKH.current) { pKH.current = kickHiKey; playShot(shots.kick); aim.current = { v: -0.3, until: performance.now() + 700 } } }, [kickHiKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickLoKey > pKL.current) { pKL.current = kickLoKey; playShot(shots.kick); aim.current = { v: 0.28, until: performance.now() + 700 } } }, [kickLoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hitKey > pH.current) { pH.current = hitKey; playShot(shots.hit) } }, [hitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, dt) => {
    mixer.update(dt)
    // PLANT the fighter: strip horizontal root motion so they stay on their
    // side and don't wander/pass through each other (2D-fighter feel)
    if (hips && hips0.current) { hips.position.x = hips0.current.x; hips.position.z = hips0.current.z }
    // oversized head, but NO sway — the fighter stays focused on the opponent.
    // With a swapped head, squash the model's own head so the billboard replaces it.
    if (head) head.scale.setScalar(headImg ? 0.02 : HEAD_SCALE)
    // CLOSED FISTS: squash the open-paddle hands into compact fists every frame
    // (short along the fingers, chunkier across) — render-verified at game distance
    if (handL) handL.scale.set(1.2, 0.45, 1.2)
    if (handR) handR.scale.set(1.2, 0.45, 1.2)
    // kick AIM tilt (head = lean back, foot rises high / leg = lean forward,
    // foot drops low) — axis calibrated by render: rotation.x is the pitch
    // along the fight line for these rigs
    if (fit.current) {
      const target = performance.now() < aim.current.until ? aim.current.v : 0
      fit.current.rotation.x += (target - fit.current.rotation.x) * Math.min(1, dt * 14)
    }
  })

  // Opponent (player 2) is MIRRORED across X — like every fighting game — so its
  // asymmetric boxing guard reads correctly instead of turning into an arms-up pose.
  return (
    <group position={[x, y, 0.6]} rotation={[0, faceY, 0]} scale={[mirror ? -1 : 1, duck ? 0.68 : 1, 1]}>
      <group ref={fit}><primitive object={scene} /></group>
      {headImg && <BillboardHead url={headImg} getHeadBone={() => head} />}
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


export default function PvpArena3D({ playerPrefix, oppPrefix, playerHeadImg, oppHeadImg, playerJabRKey = 0, playerJabLKey = 0, oppJabRKey = 0, oppJabLKey = 0, playerKickHiKey = 0, playerKickLoKey = 0, oppKickHiKey = 0, oppKickLoKey = 0, playerHitKey = 0, oppHitKey = 0, solo = false, playerX = -1, playerY = 0, playerDuck = false, oppX = 1, arena = 'foundry' }:
  { playerPrefix: string; oppPrefix?: string; playerHeadImg?: string; oppHeadImg?: string; playerJabRKey?: number; playerJabLKey?: number; oppJabRKey?: number; oppJabLKey?: number; playerKickHiKey?: number; playerKickLoKey?: number; oppKickHiKey?: number; oppKickLoKey?: number; playerHitKey?: number; oppHitKey?: number; solo?: boolean; playerX?: number; playerY?: number; playerDuck?: boolean; oppX?: number; arena?: string }) {
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
      <Suspense fallback={null}>
        <Backdrop url={`/arenas/${arena}.jpg`} />
        {solo ? (
          <Fighter prefix={playerPrefix} x={0} faceY={Math.PI / 2} headImg={playerHeadImg} jabRKey={playerJabRKey} />
        ) : (
          // Classic fighting-game side view: player faces directly right (profile),
          // opponent is a mirror flip facing left. (Model front is local -X, so
          // rotation.y = +PI/2 points the fighter down the +X axis.)
          <>
            <Fighter prefix={playerPrefix} x={playerX} y={playerY} duck={playerDuck} faceY={Math.PI / 2} headImg={playerHeadImg}
              jabRKey={playerJabRKey} jabLKey={playerJabLKey} kickHiKey={playerKickHiKey} kickLoKey={playerKickLoKey} hitKey={playerHitKey} />
            {oppPrefix && <Fighter prefix={oppPrefix} x={oppX} faceY={-Math.PI / 2} mirror headImg={oppHeadImg}
              jabRKey={oppJabRKey} jabLKey={oppJabLKey} kickHiKey={oppKickHiKey} kickLoKey={oppKickLoKey} hitKey={oppHitKey} />}
          </>
        )}
        <ContactShadows position={[0, 0.01, 0.6]} opacity={0.65} scale={12} blur={2.6} far={5} color="#000000" />
      </Suspense>
      <EffectComposer>
        <Bloom intensity={0.6} luminanceThreshold={0.7} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.28} darkness={0.8} />
      </EffectComposer>
    </Canvas>
  )
}

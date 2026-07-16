'use client'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Rigged + animated enemy (Meshy). Loads two GLBs that share one skeleton:
//   <prefix>_idle.glb / <prefix>_throw.glb
// Oversized head with a gentle bobble (bobblehead), idle at rest, plays the
// throw (+ a flying hammer) when the battle bumps `attackKey`. `onReady` fires
// once the model is in-scene so the caller can hide the 2D fallback.

function Hammer() {
  return (
    <group rotation={[0, 0, Math.PI / 5]}>
      <mesh position={[0, -0.42, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.95, 10]} />
        <meshStandardMaterial color="#7c4a21" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[0.62, 0.32, 0.32]} />
        <meshStandardMaterial color="#b0b4bb" metalness={0.85} roughness={0.28} />
      </mesh>
    </group>
  )
}

const HEAD_SCALE = 1.4 // oversized bobble head — funny, not overdone

function Model({ prefix, faceY, attackKey, onReady }: { prefix: string; faceY: number; attackKey: number; onReady?: () => void }) {
  const idleGltf = useGLTF(`/models/${prefix}_idle.glb`)
  const throwGltf = useGLTF(`/models/${prefix}_throw.glb`)
  const scene = idleGltf.scene
  const root = useRef<THREE.Group>(null!)
  const fit = useRef<THREE.Group>(null!)
  const hammer = useRef<THREE.Group>(null!)
  const throwPending = useRef(false)
  const launchAt = useRef(-1)
  const prevKey = useRef(0)

  const head = useMemo(() => scene.getObjectByName('Head') ?? null, [scene])
  // same closed-fist fix as PvP: the meshes have flat open hands baked in
  const handL = useMemo(() => scene.getObjectByName('LeftHand') ?? null, [scene])
  const handR = useMemo(() => scene.getObjectByName('RightHand') ?? null, [scene])
  // toe bones — the anim clips carry root motion that lifts the character off
  // the floor, so we re-ground the feet every frame against these
  const toeL = useMemo(() => scene.getObjectByName('LeftToeBase') ?? null, [scene])
  const toeR = useMemo(() => scene.getObjectByName('RightToeBase') ?? null, [scene])
  const toeTargetY = useRef<number | null>(null)
  const vA = useMemo(() => new THREE.Vector3(), [])
  const vB = useMemo(() => new THREE.Vector3(), [])

  // Manual mixer so the head bobble in useFrame runs AFTER the animation update
  const { mixer, idleAction, throwAction } = useMemo(() => {
    const m = new THREE.AnimationMixer(scene)
    const ic = idleGltf.animations[0]
    const tc = throwGltf.animations[0]
    const ia = ic ? m.clipAction(ic) : null
    const ta = tc ? m.clipAction(tc) : null
    if (ta) { ta.setLoop(THREE.LoopOnce, 1); ta.clampWhenFinished = true }
    return { mixer: m, idleAction: ia, throwAction: ta }
  }, [scene, idleGltf.animations, throwGltf.animations])

  // onReady lives in a ref so the measurement effect below NEVER re-runs from
  // a parent re-render. Re-measuring mid-animation was re-grounding the model
  // to a random pose height every timer tick — sprites drifted into the sky.
  const onReadyRef = useRef(onReady)
  useEffect(() => { onReadyRef.current = onReady })

  useLayoutEffect(() => {
    // drei caches GLTF scenes: bones still hold the LAST battle's pose, so a
    // remount would measure a random animation frame (the "some sprites are
    // too small" variance). Snapshot every bone's loaded local transform the
    // first time, restore it before measuring on every mount after.
    // (NOT skeleton.pose() — it ignores armature node scaling on these rigs.)
    if (!scene.userData._restSaved) {
      scene.userData._restSaved = true
      scene.traverse(o => {
        if ((o as THREE.Bone).isBone) o.userData._rest = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }
      })
    }
    scene.traverse(o => {
      const r = o.userData._rest
      if ((o as THREE.Bone).isBone && r) { o.position.copy(r.p); o.quaternion.copy(r.q); o.scale.copy(r.s) }
    })
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 2.75 / (size.y || 1) // fill most of the frame — reads big on phones
    if (fit.current) {
      fit.current.scale.setScalar(s)
      fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    }
    // remember where the toes sit in the bind pose (soles on the ground) so
    // the per-frame grounding knows the target height — measured ONCE
    if (toeL && toeR) {
      toeTargetY.current = Math.min(toeL.getWorldPosition(vA).y, toeR.getWorldPosition(vB).y)
    }
    onReadyRef.current?.()
  }, [scene, toeL, toeR, vA, vB])

  useEffect(() => { idleAction?.reset().play() }, [idleAction])

  useEffect(() => {
    if (attackKey <= 0 || attackKey === prevKey.current || !throwAction) return
    prevKey.current = attackKey
    throwAction.reset().fadeIn(0.1).play()
    idleAction?.fadeOut(0.1)
    throwPending.current = true
    const onFinished = (e: any) => {
      if (e.action !== throwAction) return
      idleAction?.reset().fadeIn(0.25).play()
      throwAction.fadeOut(0.25)
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  }, [attackKey, mixer, idleAction, throwAction])

  useFrame((state, dt) => {
    mixer.update(dt)
    if (root.current) root.current.rotation.y = faceY
    // GROUND LOCK: cancel the clips' vertical root motion — feet stay planted
    // through idle AND throw (no hover, no launch-up during attacks)
    if (toeTargetY.current !== null && toeL && toeR && fit.current) {
      const minToeY = Math.min(toeL.getWorldPosition(vA).y, toeR.getWorldPosition(vB).y)
      fit.current.position.y += toeTargetY.current - minToeY
    }
    const t = state.clock.elapsedTime
    // Oversized head — scale only. NO additive rotation "bobble": on rigs
    // whose clips don't animate the head bone, `rotation +=` accumulates and
    // the head tumbles into the torso (the headless-sprite bug).
    if (head) head.scale.setScalar(HEAD_SCALE)
    // closed fists (squash the open-paddle hands, like the PvP fighters)
    if (handL) handL.scale.set(1.2, 0.45, 1.2)
    if (handR) handR.scale.set(1.2, 0.45, 1.2)
    // Flying hammer, launched mid-throw
    if (throwPending.current) { launchAt.current = t; throwPending.current = false }
    const h = hammer.current
    if (h) {
      const e = t - launchAt.current
      if (launchAt.current > 0 && e > 0.35 && e < 0.95) {
        const p = (e - 0.35) / 0.6
        h.visible = true
        // arcs toward the player but stops well short of the camera —
        // no more full-screen hammer flash
        h.position.set(
          THREE.MathUtils.lerp(0.55, 0.1, p),
          THREE.MathUtils.lerp(1.7, 0.55, p),
          THREE.MathUtils.lerp(0.3, 3.1, p),
        )
        h.rotation.z += dt * 13
        h.rotation.x += dt * 8
        h.scale.setScalar(THREE.MathUtils.lerp(0.5, 1.05, p))
      } else h.visible = false
    }
  })

  return (
    // ground at -0.95: deep models (flared dresses) stay inside the frame's
    // nearer perspective planes instead of clipping at the canvas bottom
    <group position={[0, -0.95, 0]}>
      <group ref={root}><group ref={fit}><primitive object={scene} /></group></group>
      <group ref={hammer} visible={false}><Hammer /></group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[1.05, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.46} />
      </mesh>
    </group>
  )
}

export default function Enemy3D({ prefix, faceY = 0, attackKey = 0, onReady }: { prefix: string; faceY?: number; attackKey?: number; onReady?: () => void }) {
  return (
    <Canvas frameloop="always" style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0.4, 4.4], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      {/* warm street-fire key + cool night rim to match the battle backdrop */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 6, 4]} intensity={2.0} color="#ffd6a0" />
      <directionalLight position={[-4, 2, -3]} intensity={0.8} color="#6a8bff" />
      <pointLight position={[0, 1, 3]} intensity={0.5} color="#ffb877" />
      <Suspense fallback={null}>
        <Model prefix={prefix} faceY={faceY} attackKey={attackKey} onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/models/comrade_idle.glb')
useGLTF.preload('/models/comrade_throw.glb')

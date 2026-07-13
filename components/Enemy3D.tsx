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

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 3.0 / (size.y || 1)
    if (fit.current) {
      fit.current.scale.setScalar(s)
      fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    }
    onReady?.()
  }, [scene, onReady])

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
    const t = state.clock.elapsedTime
    // Oversized head + subtle bobble, added on top of the animated pose
    if (head) {
      head.scale.setScalar(HEAD_SCALE)
      head.rotation.x += Math.sin(t * 3.2) * 0.05
      head.rotation.z += Math.cos(t * 2.5) * 0.06
    }
    // Flying hammer, launched mid-throw
    if (throwPending.current) { launchAt.current = t; throwPending.current = false }
    const h = hammer.current
    if (h) {
      const e = t - launchAt.current
      if (launchAt.current > 0 && e > 0.35 && e < 1.15) {
        const p = (e - 0.35) / 0.8
        h.visible = true
        h.position.set(
          THREE.MathUtils.lerp(0.55, 0, p),
          THREE.MathUtils.lerp(1.7, 0.7, p),
          THREE.MathUtils.lerp(0.3, 5.6, p),
        )
        h.rotation.z += dt * 15
        h.rotation.x += dt * 9
        h.scale.setScalar(THREE.MathUtils.lerp(0.5, 1.9, p))
      } else h.visible = false
    }
  })

  return (
    <group position={[0, -1.5, 0]}>
      <group ref={root}><group ref={fit}><primitive object={scene} /></group></group>
      <group ref={hammer} visible={false}><Hammer /></group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.95, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.34} />
      </mesh>
    </group>
  )
}

export default function Enemy3D({ prefix, faceY = 0, attackKey = 0, onReady }: { prefix: string; faceY?: number; attackKey?: number; onReady?: () => void }) {
  return (
    <Canvas frameloop="always" style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0.4, 4.4], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 6, 4]} intensity={1.8} />
      <directionalLight position={[-4, 2, 3]} intensity={0.6} color="#f87171" />
      <pointLight position={[0, 1, 3]} intensity={0.5} color="#fca5a5" />
      <Suspense fallback={null}>
        <Model prefix={prefix} faceY={faceY} attackKey={attackKey} onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/models/comrade_idle.glb')
useGLTF.preload('/models/comrade_throw.glb')

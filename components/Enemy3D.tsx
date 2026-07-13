'use client'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'

// Rigged + animated enemy (Meshy). Loads two GLBs that share one skeleton:
//   <prefix>_idle.glb  — looping idle
//   <prefix>_throw.glb — over-shoulder throw
// Idles at rest and plays the throw (plus a flying hammer) each time the battle
// bumps `attackKey` (i.e. the enemy attacks). faceY aims the body at the player.

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

function Model({ prefix, faceY, attackKey }: { prefix: string; faceY: number; attackKey: number }) {
  const idleGltf = useGLTF(`/models/${prefix}_idle.glb`)
  const throwGltf = useGLTF(`/models/${prefix}_throw.glb`)
  const root = useRef<THREE.Group>(null!)
  const fit = useRef<THREE.Group>(null!)
  const hammer = useRef<THREE.Group>(null!)
  const throwPending = useRef(false)
  const launchAt = useRef(-1)
  const prevKey = useRef(0)

  // Both clips come from the same rig → bind to the same bones by name
  const clips = useMemo(() => {
    const out: THREE.AnimationClip[] = []
    const idle = idleGltf.animations[0]?.clone(); if (idle) { idle.name = 'idle'; out.push(idle) }
    const thr = throwGltf.animations[0]?.clone(); if (thr) { thr.name = 'throw'; out.push(thr) }
    return out
  }, [idleGltf.animations, throwGltf.animations])

  const { actions, mixer } = useAnimations(clips, root)

  // Scale to ~3 units tall, feet on the ground, centered on x/z
  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(idleGltf.scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 3.0 / (size.y || 1)
    if (fit.current) {
      fit.current.scale.setScalar(s)
      fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    }
  }, [idleGltf.scene])

  // Idle by default
  useEffect(() => {
    const idle = actions['idle']
    if (idle) idle.reset().fadeIn(0.3).play()
    return () => { idle?.fadeOut(0.2) }
  }, [actions])

  // Throw once whenever the enemy attacks (attackKey bumps to a new value)
  useEffect(() => {
    if (attackKey <= 0 || attackKey === prevKey.current) return
    prevKey.current = attackKey
    const idle = actions['idle'], thr = actions['throw']
    if (!thr) return
    thr.reset()
    thr.setLoop(THREE.LoopOnce, 1)
    thr.clampWhenFinished = true
    thr.fadeIn(0.12).play()
    idle?.fadeOut(0.12)
    throwPending.current = true // arms the flying hammer, launched mid-throw
    const onFinished = (e: any) => {
      if (e.action !== thr) return
      idle?.reset().fadeIn(0.25).play()
      thr.fadeOut(0.25)
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  }, [attackKey, actions, mixer])

  useFrame((state, dt) => {
    if (root.current) root.current.rotation.y = faceY
    const t = state.clock.elapsedTime
    if (throwPending.current) { launchAt.current = t; throwPending.current = false }
    const h = hammer.current
    if (!h) return
    const e = t - launchAt.current
    if (launchAt.current > 0 && e > 0.35 && e < 1.15) {
      const p = (e - 0.35) / 0.8
      h.visible = true
      h.position.set(
        THREE.MathUtils.lerp(0.55, 0, p),
        THREE.MathUtils.lerp(1.7, 0.7, p),
        THREE.MathUtils.lerp(0.3, 5.6, p), // flies at / past the camera (player)
      )
      h.rotation.z += dt * 15
      h.rotation.x += dt * 9
      h.scale.setScalar(THREE.MathUtils.lerp(0.5, 1.9, p))
    } else {
      h.visible = false
    }
  })

  return (
    <group position={[0, -1.5, 0]}>
      <group ref={root}>
        <group ref={fit}><primitive object={idleGltf.scene} /></group>
      </group>
      <group ref={hammer} visible={false}><Hammer /></group>
      {/* ground shadow so he reads as planted, not floating */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.95, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.34} />
      </mesh>
    </group>
  )
}

export default function Enemy3D({ prefix, faceY = 0, attackKey = 0 }: { prefix: string; faceY?: number; attackKey?: number }) {
  return (
    <Canvas frameloop="always" style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0.4, 4.4], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 6, 4]} intensity={1.8} />
      <directionalLight position={[-4, 2, 3]} intensity={0.6} color="#f87171" />
      <pointLight position={[0, 1, 3]} intensity={0.5} color="#fca5a5" />
      <Suspense fallback={null}>
        <Model prefix={prefix} faceY={faceY} attackKey={attackKey} />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/models/comrade_idle.glb')
useGLTF.preload('/models/comrade_throw.glb')

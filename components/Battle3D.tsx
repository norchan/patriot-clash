'use client'
import { Suspense, useMemo, useRef, useLayoutEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const ATTACK_DUR = 0.5

// One fighter: loads a GLB, normalizes its size, idles with a gentle bob, and
// lunges toward the center when its attack ref is triggered.
function Fighter({ url, side, attackRef }: {
  url: string; side: -1 | 1; attackRef: React.MutableRefObject<number>
}) {
  const { scene } = useGLTF(url)
  const clone = useMemo(() => scene.clone(true), [scene])
  const group = useRef<THREE.Group>(null!)
  const baseX = side * 1.7
  const phase = side > 0 ? Math.PI : 0

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(clone)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 2.4 / (size.y || 1)
    clone.scale.setScalar(s)
    // center on X/Z, drop feet to y=0
    clone.position.set(-center.x * s, -box.min.y * s, -center.z * s)
  }, [clone])

  useFrame((state, dt) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    let x = baseX, y = Math.sin(t * 2 + phase) * 0.06, z = 0
    if (attackRef.current > 0) {
      attackRef.current = Math.max(0, attackRef.current - dt)
      const e = 1 - attackRef.current / ATTACK_DUR // 0..1
      const lunge = Math.sin(e * Math.PI)          // 0..1..0
      x = baseX - side * lunge * 1.5
      z = lunge * 0.35
      y += lunge * 0.18
    }
    group.current.position.set(x, y, z)
    group.current.rotation.y = side > 0 ? -0.35 : 0.35
  })

  return <group ref={group}><primitive object={clone} /></group>
}

export default function Battle3D({ leftUrl, rightUrl, leftAtk, rightAtk }: {
  leftUrl: string; rightUrl: string
  leftAtk: React.MutableRefObject<number>; rightAtk: React.MutableRefObject<number>
}) {
  return (
    <Canvas camera={{ position: [0, 1.7, 6.4], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#0a0616']} />
      <fog attach="fog" args={['#0a0616', 8, 16]} />
      <hemisphereLight args={['#ffffff', '#3b1a5a', 0.7]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 7, 5]} intensity={1.8} />
      <directionalLight position={[-6, 3, -2]} intensity={0.6} color="#a855f7" />
      <pointLight position={[0, 3, 4]} intensity={0.6} color="#f472b6" />

      <Suspense fallback={null}>
        <Fighter url={leftUrl} side={-1} attackRef={leftAtk} />
        <Fighter url={rightUrl} side={1} attackRef={rightAtk} />
      </Suspense>

      {/* stage */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[6, 64]} />
        <meshStandardMaterial color="#160a2e" roughness={0.9} metalness={0.1} />
      </mesh>
      <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={12} blur={2.6} far={4} resolution={512} color="#000000" />

      <OrbitControls enablePan={false} minDistance={4} maxDistance={11} target={[0, 1, 0]} maxPolarAngle={Math.PI / 1.9} />
    </Canvas>
  )
}

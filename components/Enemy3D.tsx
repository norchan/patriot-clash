'use client'
import { Suspense, useMemo, useRef, useLayoutEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// A front-facing, GROUNDED 3D enemy that winds up and hurls a spinning hammer
// at the player on a loop. Transparent canvas so it sits in the battle scene.
// faceY rotates the whole body to aim it at the player (tune per model).
const CYCLE = 2.6

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

function Model({ url, faceY }: { url: string; faceY: number }) {
  const { scene } = useGLTF(url)
  const clone = useMemo(() => scene.clone(true), [scene])
  const body = useRef<THREE.Group>(null!)
  const hammer = useRef<THREE.Group>(null!)

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(clone)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 3.0 / (size.y || 1)
    clone.scale.setScalar(s)
    // feet at y=0, centered on x/z
    clone.position.set(-center.x * s, -box.min.y * s, -center.z * s)
  }, [clone])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const c = (t % CYCLE) / CYCLE // 0..1 through the throw
    // wind up (lean back) → snap forward → settle
    let leanX = 0
    if (c < 0.4) leanX = -(c / 0.4) * 0.22
    else if (c < 0.55) leanX = ((c - 0.4) / 0.15) * 0.5 - 0.22
    else leanX = Math.max(0, 0.28 - (c - 0.55) * 0.7)
    // small forward lunge on release
    const lunge = c > 0.4 && c < 0.7 ? Math.sin(((c - 0.4) / 0.3) * Math.PI) * 0.25 : 0
    if (body.current) {
      body.current.rotation.set(leanX * 0.5, faceY, 0)
      body.current.position.z = lunge
      body.current.scale.y = 1 + 0.02 * Math.sin(t * 3) // breathe (no hover)
    }
    // hammer launch toward the player
    if (hammer.current) {
      if (c > 0.5 && c < 1.0) {
        const p = (c - 0.5) / 0.5
        hammer.current.visible = true
        hammer.current.position.set(
          THREE.MathUtils.lerp(0.7, 0, p),
          THREE.MathUtils.lerp(1.9, 0.7, p),
          THREE.MathUtils.lerp(0.4, 5.6, p), // fly at / past the camera
        )
        hammer.current.rotation.z += dt * 15
        hammer.current.rotation.x += dt * 9
        hammer.current.scale.setScalar(THREE.MathUtils.lerp(0.55, 1.9, p))
      } else {
        hammer.current.visible = false
      }
    }
  })

  return (
    <group position={[0, -1.5, 0]}>
      <group ref={body}><primitive object={clone} /></group>
      <group ref={hammer} visible={false}><Hammer /></group>
      {/* ground shadow so he reads as planted, not floating */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.95, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.34} />
      </mesh>
    </group>
  )
}

export default function Enemy3D({ url, faceY = 0 }: { url: string; faceY?: number }) {
  return (
    <Canvas frameloop="always" style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0.4, 4.4], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 6, 4]} intensity={1.8} />
      <directionalLight position={[-4, 2, 3]} intensity={0.6} color="#f87171" />
      <pointLight position={[0, 1, 3]} intensity={0.5} color="#fca5a5" />
      <Suspense fallback={null}>
        <Model url={url} faceY={faceY} />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/models/comrade.glb')

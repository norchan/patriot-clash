'use client'
import { Suspense, useMemo, useRef, useLayoutEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// A front-facing 3D enemy that stares down the player and repeatedly winds up
// and hurls a spinning hammer toward the camera. Transparent canvas so it sits
// right in the existing battle scene. (Static mesh — the throw is body motion +
// a projectile; real arm rigs come with the Meshy models.)
const CYCLE = 2.4 // seconds per throw

function Hammer() {
  return (
    <group rotation={[0, 0, Math.PI / 5]}>
      <mesh position={[0, -0.32, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.72, 10]} />
        <meshStandardMaterial color="#7c4a21" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.46, 0.24, 0.24]} />
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
    const s = 2.7 / (size.y || 1)
    clone.scale.setScalar(s)
    clone.position.set(-center.x * s, -center.y * s, -center.z * s) // center at origin
  }, [clone])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const c = (t % CYCLE) / CYCLE // 0..1 through the throw
    // body: breathe + wind back then snap forward
    let lean = Math.sin(t * 2) * 0.02
    if (c < 0.35) lean += -(c / 0.35) * 0.28          // wind up (lean back)
    else if (c < 0.5) lean += ((c - 0.35) / 0.15) * 0.5 - 0.28 // snap forward
    else lean += Math.max(0, 0.22 - (c - 0.5) * 0.6)  // settle
    if (body.current) {
      body.current.rotation.x = lean
      body.current.rotation.y = faceY
      body.current.position.y = Math.sin(t * 2) * 0.03
    }
    // hammer: launch toward the camera during the release
    if (hammer.current) {
      if (c > 0.44 && c < 0.98) {
        const p = (c - 0.44) / 0.54 // 0..1
        hammer.current.visible = true
        hammer.current.position.set(
          THREE.MathUtils.lerp(0.55, 0, p),
          THREE.MathUtils.lerp(0.3, -0.1, p),
          THREE.MathUtils.lerp(0.2, 5.2, p), // toward / past the player
        )
        hammer.current.rotation.z += dt * 20
        hammer.current.rotation.x += dt * 12
        hammer.current.scale.setScalar(THREE.MathUtils.lerp(0.45, 1.5, p))
      } else {
        hammer.current.visible = false
      }
    }
  })

  return (
    <>
      <group ref={body}><primitive object={clone} /></group>
      <group ref={hammer} visible={false}><Hammer /></group>
    </>
  )
}

export default function Enemy3D({ url, faceY = 0 }: { url: string; faceY?: number }) {
  return (
    <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 0, 4.6], fov: 42 }}
      dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 4]} intensity={1.7} />
      <directionalLight position={[-4, 2, 2]} intensity={0.6} color="#f87171" />
      <pointLight position={[0, 1, 3]} intensity={0.5} color="#fca5a5" />
      <Suspense fallback={null}>
        <Model url={url} faceY={faceY} />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/models/comrade.glb')

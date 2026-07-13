'use client'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, ContactShadows } from '@react-three/drei'
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
  { id: 'fighter5', label: 'Rainbow', img: '/fighters/fighter5.png', demOnly: true },
  { id: 'fighter6', label: 'Deon', img: '/fighters/fighter6.png' },
]

const HEAD_SCALE = 1.35

function Fighter({ prefix, position, faceY, attackKey }: { prefix: string; position: [number, number, number]; faceY: number; attackKey: number }) {
  const idleGltf = useGLTF(`/models/${prefix}_idle.glb`)
  const punchGltf = useGLTF(`/models/${prefix}_punch.glb`)
  const scene = idleGltf.scene
  const fit = useRef<THREE.Group>(null!)
  const prevKey = useRef(0)
  const head = useMemo(() => scene.getObjectByName('Head') ?? null, [scene])

  const { mixer, idleAction, punchAction } = useMemo(() => {
    const m = new THREE.AnimationMixer(scene)
    const ia = idleGltf.animations[0] ? m.clipAction(idleGltf.animations[0]) : null
    const pa = punchGltf.animations[0] ? m.clipAction(punchGltf.animations[0]) : null
    if (pa) { pa.setLoop(THREE.LoopOnce, 1); pa.clampWhenFinished = true }
    return { mixer: m, idleAction: ia, punchAction: pa }
  }, [scene, idleGltf.animations, punchGltf.animations])

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 1.75 / (size.y || 1)
    if (fit.current) { fit.current.scale.setScalar(s); fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s) }
  }, [scene])

  useEffect(() => { idleAction?.reset().play() }, [idleAction])
  useEffect(() => {
    if (attackKey <= 0 || attackKey === prevKey.current || !punchAction) return
    prevKey.current = attackKey
    punchAction.reset().fadeIn(0.08).play(); idleAction?.fadeOut(0.08)
    const onFin = (e: any) => { if (e.action === punchAction) { idleAction?.reset().fadeIn(0.2).play(); punchAction.fadeOut(0.2) } }
    mixer.addEventListener('finished', onFin)
    return () => mixer.removeEventListener('finished', onFin)
  }, [attackKey, mixer, idleAction, punchAction])

  useFrame((state, dt) => {
    mixer.update(dt)
    if (head) { head.scale.setScalar(HEAD_SCALE); const t = state.clock.elapsedTime; head.rotation.z += Math.sin(t * 3.3) * 0.05; head.rotation.x += Math.cos(t * 2.6) * 0.04 }
  })

  return (
    <group position={position} rotation={[0, faceY, 0]}>
      <group ref={fit}><primitive object={scene} /></group>
    </group>
  )
}

// ── Cheering crowd (instanced) ──────────────────────────────────────────────
function Crowd() {
  const bodies = useRef<THREE.InstancedMesh>(null!)
  const heads = useRef<THREE.InstancedMesh>(null!)
  const data = useMemo(() => {
    const out: { x: number; y: number; z: number; phase: number; body: THREE.Color; skin: THREE.Color }[] = []
    const SKIN = ['#f6d5b8', '#e8b98e', '#cf9a6b', '#a9744f', '#7a4f33'].map(c => new THREE.Color(c))
    const RED = new THREE.Color('#d1352b'), BLUE = new THREE.Color('#2f6bd8')
    // tiered stands: back + both sides
    const place = (cx: number, cz: number, cols: number, rows: number, dx: number, dz: number, faceSpread: number) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        out.push({
          x: cx + (c - cols / 2) * dx + (Math.random() - 0.5) * 0.2,
          y: 0.55 + r * 0.32,
          z: cz - r * dz + (Math.random() - 0.5) * 0.2,
          phase: Math.random() * Math.PI * 2,
          // exactly half the crowd in Republican red, half in Democrat blue
          body: (out.length % 2 === 0 ? RED : BLUE).clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.08),
          skin: SKIN[(Math.random() * SKIN.length) | 0],
        })
      }
    }
    place(0, -3.2, 26, 6, 0.62, 0.6, 0)   // back stand
    place(-6.2, -0.5, 6, 5, 0.6, 0.9, 0)  // left stand (rows recede in z)
    place(6.2, -0.5, 6, 5, 0.6, 0.9, 0)   // right stand
    return out
  }, [])

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    data.forEach((d, i) => {
      m.makeTranslation(d.x, d.y, d.z)
      bodies.current.setMatrixAt(i, m); heads.current.setMatrixAt(i, new THREE.Matrix4().makeTranslation(d.x, d.y + 0.52, d.z))
      bodies.current.setColorAt(i, d.body); heads.current.setColorAt(i, d.skin)
    })
    bodies.current.instanceMatrix.needsUpdate = true; heads.current.instanceMatrix.needsUpdate = true
    if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true
    if (heads.current.instanceColor) heads.current.instanceColor.needsUpdate = true
  }, [data])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const m = new THREE.Matrix4()
    for (let i = 0; i < data.length; i++) {
      const d = data[i]
      const bob = Math.sin(t * 4 + d.phase) * 0.09
      m.makeTranslation(d.x, d.y + Math.max(0, bob), d.z); bodies.current.setMatrixAt(i, m)
      m.makeTranslation(d.x, d.y + 0.52 + Math.max(0, bob), d.z); heads.current.setMatrixAt(i, m)
    }
    bodies.current.instanceMatrix.needsUpdate = true; heads.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, data.length]} castShadow>
        <capsuleGeometry args={[0.2, 0.5, 4, 8]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, data.length]}>
        <sphereGeometry args={[0.19, 12, 12]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </group>
  )
}

function Street() {
  return (
    <group>
      {/* asphalt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#3a3d42" roughness={1} />
      </mesh>
      {/* fight ring highlight */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0.5]}>
        <ringGeometry args={[2.4, 2.7, 48]} />
        <meshBasicMaterial color="#e2c044" transparent opacity={0.5} />
      </mesh>
      {/* side buildings */}
      {[-8, 8].map((x, i) => (
        <mesh key={i} position={[x, 3, -5]}>
          <boxGeometry args={[4, 6, 8]} />
          <meshStandardMaterial color={i ? '#4a4038' : '#454b52'} roughness={0.95} />
        </mesh>
      ))}
      {/* back wall / skyline */}
      <mesh position={[0, 4, -8.5]}>
        <boxGeometry args={[24, 8, 1]} />
        <meshStandardMaterial color="#2b2f36" roughness={1} />
      </mesh>
    </group>
  )
}

export default function PvpArena3D({ playerPrefix, oppPrefix, playerAttackKey = 0, oppAttackKey = 0, solo = false }:
  { playerPrefix: string; oppPrefix?: string; playerAttackKey?: number; oppAttackKey?: number; solo?: boolean }) {
  return (
    <Canvas shadows style={{ width: '100%', height: '100%' }}
      camera={{ position: solo ? [0, 1.5, 4.2] : [0, 2.1, 6.2], fov: 42 }}
      dpr={[1, 2]} gl={{ alpha: false, antialias: true }}>
      <color attach="background" args={['#1b2230']} />
      <fog attach="fog" args={['#1b2230', 12, 26]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 5]} intensity={1.7} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-5, 3, 2]} intensity={0.5} color="#93c5fd" />
      <pointLight position={[0, 3, 3]} intensity={0.6} color="#fca5a5" />
      <Suspense fallback={null}>
        <Street />
        <Crowd />
        {solo ? (
          // face the camera in the picker
          <Fighter prefix={playerPrefix} position={[0, 0, 0.8]} faceY={Math.PI} attackKey={playerAttackKey} />
        ) : (
          // turn the fighters IN toward each other (models front-face is -Z)
          <>
            <Fighter prefix={playerPrefix} position={[-1.5, 0, 0.8]} faceY={-Math.PI / 2} attackKey={playerAttackKey} />
            {oppPrefix && <Fighter prefix={oppPrefix} position={[1.5, 0, 0.8]} faceY={Math.PI / 2} attackKey={oppAttackKey} />}
          </>
        )}
        <ContactShadows position={[0, 0.02, 0.6]} opacity={0.5} scale={8} blur={2.2} far={3} />
      </Suspense>
    </Canvas>
  )
}

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

// Correction for the model's front axis (these Meshy models' front is local -X).
// Fighters always aim at their target; change by ±PI/2 if they don't face it.
const FRONT_FIX = Math.PI / 2
// rotation.y so the fighter at (px,pz) faces the point (tx,tz)
const faceToward = (px: number, pz: number, tx: number, tz: number) => Math.atan2(tx - px, tz - pz) + FRONT_FIX

function Fighter({ prefix, x, y = 0, duck = false, targetX, targetZ = 0.6, attackKey, kickKey = 0, hitKey = 0 }:
  { prefix: string; x: number; y?: number; duck?: boolean; targetX: number; targetZ?: number; attackKey: number; kickKey?: number; hitKey?: number }) {
  // resting loop = a focused COMBAT STANCE; punch/kick/hit are one-shots
  const stanceGltf = useGLTF(`/models/${prefix}_stance.glb`)
  const punchGltf = useGLTF(`/models/${prefix}_punch.glb`)
  const kickGltf = useGLTF(`/models/${prefix}_kick.glb`)
  const hitGltf = useGLTF(`/models/${prefix}_hit.glb`)
  const scene = stanceGltf.scene
  const fit = useRef<THREE.Group>(null!)
  const head = useMemo(() => scene.getObjectByName('Head') ?? null, [scene])
  const hips = useMemo(() => scene.getObjectByName('Hips') ?? null, [scene])
  const hips0 = useRef<THREE.Vector3 | null>(null)

  const { mixer, stance, shots } = useMemo(() => {
    const m = new THREE.AnimationMixer(scene)
    const st = stanceGltf.animations[0] ? m.clipAction(stanceGltf.animations[0]) : null
    const oneShot = (g: { animations: THREE.AnimationClip[] }) => {
      const a = g.animations[0] ? m.clipAction(g.animations[0]) : null
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      return a
    }
    return { mixer: m, stance: st, shots: { punch: oneShot(punchGltf), kick: oneShot(kickGltf), hit: oneShot(hitGltf) } }
  }, [scene, stanceGltf.animations, punchGltf.animations, kickGltf.animations, hitGltf.animations])

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 1.75 / (size.y || 1)
    if (fit.current) { fit.current.scale.setScalar(s); fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s) }
    if (hips) hips0.current = hips.position.clone()
  }, [scene, hips])

  useEffect(() => { stance?.reset().play() }, [stance])
  // return to stance whenever a one-shot (punch/kick/hit) finishes
  useEffect(() => {
    const onFin = (e: any) => {
      if (e.action === shots.punch || e.action === shots.kick || e.action === shots.hit) {
        stance?.reset().fadeIn(0.15).play(); e.action.fadeOut(0.15)
      }
    }
    mixer.addEventListener('finished', onFin)
    return () => mixer.removeEventListener('finished', onFin)
  }, [mixer, shots, stance])
  const playShot = (a: THREE.AnimationAction | null) => { if (!a) return; a.reset().fadeIn(0.06).play(); stance?.fadeOut(0.06) }
  const pAtk = useRef(0), pKick = useRef(0), pHit = useRef(0)
  useEffect(() => { if (attackKey > pAtk.current) { pAtk.current = attackKey; playShot(shots.punch) } }, [attackKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickKey > pKick.current) { pKick.current = kickKey; playShot(shots.kick) } }, [kickKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hitKey > pHit.current) { pHit.current = hitKey; playShot(shots.hit) } }, [hitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, dt) => {
    mixer.update(dt)
    // PLANT the fighter: strip horizontal root motion so they stay on their
    // side and don't wander/pass through each other (2D-fighter feel)
    if (hips && hips0.current) { hips.position.x = hips0.current.x; hips.position.z = hips0.current.z }
    // oversized head, but NO sway — the fighter stays focused on the opponent
    if (head) head.scale.setScalar(HEAD_SCALE)
  })

  const faceY = faceToward(x, 0.6, targetX, targetZ)
  return (
    <group position={[x, y, 0.6]} rotation={[0, faceY, 0]} scale={[1, duck ? 0.68 : 1, 1]}>
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

export default function PvpArena3D({ playerPrefix, oppPrefix, playerAttackKey = 0, oppAttackKey = 0, playerKickKey = 0, oppKickKey = 0, playerHitKey = 0, oppHitKey = 0, solo = false, playerX = -1, playerY = 0, playerDuck = false, oppX = 1 }:
  { playerPrefix: string; oppPrefix?: string; playerAttackKey?: number; oppAttackKey?: number; playerKickKey?: number; oppKickKey?: number; playerHitKey?: number; oppHitKey?: number; solo?: boolean; playerX?: number; playerY?: number; playerDuck?: boolean; oppX?: number }) {
  return (
    <Canvas shadows style={{ width: '100%', height: '100%' }}
      camera={{ position: solo ? [0, 1.5, 5.6] : [0, 2.1, 8.2], fov: 40 }}
      dpr={[1, 2]} gl={{ alpha: false, antialias: true }}
      onCreated={({ camera }) => camera.lookAt(0, 1.0, 0)}>
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
          <Fighter prefix={playerPrefix} x={0} targetX={0} targetZ={6} attackKey={playerAttackKey} />
        ) : (
          // planted on their sides, always facing each other; player can move/jump/duck
          <>
            <Fighter prefix={playerPrefix} x={playerX} y={playerY} duck={playerDuck} targetX={oppX}
              attackKey={playerAttackKey} kickKey={playerKickKey} hitKey={playerHitKey} />
            {oppPrefix && <Fighter prefix={oppPrefix} x={oppX} targetX={playerX}
              attackKey={oppAttackKey} kickKey={oppKickKey} hitKey={oppHitKey} />}
          </>
        )}
        <ContactShadows position={[0, 0.02, 0.6]} opacity={0.5} scale={8} blur={2.2} far={3} />
      </Suspense>
    </Canvas>
  )
}

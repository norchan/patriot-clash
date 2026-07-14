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
  { id: 'fighter5', label: 'Rainbow', img: '/fighters/fighter5.png', demOnly: true },
  { id: 'fighter6', label: 'Deon', img: '/fighters/fighter6.png' },
]

const HEAD_SCALE = 1.5 // realistic body, oversized bobble head

// Correction for the model's front axis (these Meshy models' front is local -X).
// Fighters always aim at their target; change by ±PI/2 if they don't face it.
const FRONT_FIX = Math.PI / 2
// rotation.y so the fighter at (px,pz) faces the point (tx,tz)
const faceToward = (px: number, pz: number, tx: number, tz: number) => Math.atan2(tx - px, tz - pz) + FRONT_FIX

function Fighter({ prefix, x, y = 0, duck = false, targetX, targetZ = 0.6, jabRKey = 0, jabLKey = 0, hitKey = 0 }:
  { prefix: string; x: number; y?: number; duck?: boolean; targetX: number; targetZ?: number; jabRKey?: number; jabLKey?: number; hitKey?: number }) {
  // Boxing: a static fists-up GUARD + left/right jab + hit one-shots
  const guardGltf = useGLTF(`/models/${prefix}_guard.glb`)
  const jabRGltf = useGLTF(`/models/${prefix}_jabR.glb`)
  const jabLGltf = useGLTF(`/models/${prefix}_jabL.glb`)
  const hitGltf = useGLTF(`/models/${prefix}_hit.glb`)
  const scene = jabRGltf.scene
  const fit = useRef<THREE.Group>(null!)
  const head = useMemo(() => scene.getObjectByName('Head') ?? null, [scene])
  const hips = useMemo(() => scene.getObjectByName('Hips') ?? null, [scene])
  const hips0 = useRef<THREE.Vector3 | null>(null)

  const { mixer, guard, guardHold, shots } = useMemo(() => {
    const m = new THREE.AnimationMixer(scene)
    // guard = the boxing-guard clip frozen at its fists-up frame
    const guardClip = guardGltf.animations[0]?.clone()
    const gd = guardClip ? m.clipAction(guardClip) : null
    const guardHold = guardClip ? guardClip.duration * 0.28 : 0 // fists-up moment before the straight
    if (gd) { gd.play(); gd.paused = true; gd.time = guardHold; gd.setEffectiveWeight(1) }
    const oneShot = (g: { animations: THREE.AnimationClip[] }) => {
      const a = g.animations[0] ? m.clipAction(g.animations[0]) : null
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      return a
    }
    return { mixer: m, guard: gd, guardHold, shots: { jabR: oneShot(jabRGltf), jabL: oneShot(jabLGltf), hit: oneShot(hitGltf) } }
  }, [scene, guardGltf.animations, jabRGltf.animations, jabLGltf.animations, hitGltf.animations])

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const s = 1.95 / (size.y || 1) // bigger fighters (fill more of the frame)
    if (fit.current) { fit.current.scale.setScalar(s); fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s) }
    if (hips) hips0.current = hips.position.clone()
  }, [scene, hips])

  // A one-shot snaps in over the guard; on finish, snap back to the guard hold
  const playShot = (a: THREE.AnimationAction | null) => {
    if (!a) return
    guard?.setEffectiveWeight(0)
    a.reset(); a.setEffectiveWeight(1); a.play()
  }
  useEffect(() => {
    const onFin = (e: any) => {
      if (e.action === shots.jabR || e.action === shots.jabL || e.action === shots.hit) {
        e.action.setEffectiveWeight(0); e.action.stop()
        if (guard) { guard.time = guardHold; guard.paused = true; guard.setEffectiveWeight(1) }
      }
    }
    mixer.addEventListener('finished', onFin)
    return () => mixer.removeEventListener('finished', onFin)
  }, [mixer, shots, guard, guardHold])
  const pR = useRef(0), pL = useRef(0), pH = useRef(0)
  useEffect(() => { if (jabRKey > pR.current) { pR.current = jabRKey; playShot(shots.jabR) } }, [jabRKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (jabLKey > pL.current) { pL.current = jabLKey; playShot(shots.jabL) } }, [jabLKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hitKey > pH.current) { pH.current = hitKey; playShot(shots.hit) } }, [hitKey]) // eslint-disable-line react-hooks/exhaustive-deps

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


export default function PvpArena3D({ playerPrefix, oppPrefix, playerJabRKey = 0, playerJabLKey = 0, oppJabRKey = 0, oppJabLKey = 0, playerHitKey = 0, oppHitKey = 0, solo = false, playerX = -1, playerY = 0, playerDuck = false, oppX = 1, arena = 'foundry' }:
  { playerPrefix: string; oppPrefix?: string; playerJabRKey?: number; playerJabLKey?: number; oppJabRKey?: number; oppJabLKey?: number; playerHitKey?: number; oppHitKey?: number; solo?: boolean; playerX?: number; playerY?: number; playerDuck?: boolean; oppX?: number; arena?: string }) {
  return (
    <Canvas shadows style={{ width: '100%', height: '100%' }}
      camera={{ position: solo ? [0, 1.2, 4.6] : [0, 1.05, 4.9], fov: solo ? 40 : 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      onCreated={({ camera }) => camera.lookAt(0, solo ? 1.0 : 0.9, 0)}>
      {/* dramatic stage lighting to match the gritty arena */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 4]} intensity={2.4} color="#ffd6a0" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <directionalLight position={[-6, 3, -3]} intensity={1.1} color="#6a8bff" />
      <spotLight position={[0, 7, 6]} angle={0.7} penumbra={0.6} intensity={1.4} color="#ffb877" />
      <Suspense fallback={null}>
        <Backdrop url={`/arenas/${arena}.jpg`} />
        {solo ? (
          <Fighter prefix={playerPrefix} x={0} targetX={0} targetZ={6} jabRKey={playerJabRKey} />
        ) : (
          <>
            <Fighter prefix={playerPrefix} x={playerX} y={playerY} duck={playerDuck} targetX={oppX}
              jabRKey={playerJabRKey} jabLKey={playerJabLKey} hitKey={playerHitKey} />
            {oppPrefix && <Fighter prefix={oppPrefix} x={oppX} targetX={playerX}
              jabRKey={oppJabRKey} jabLKey={oppJabLKey} hitKey={oppHitKey} />}
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

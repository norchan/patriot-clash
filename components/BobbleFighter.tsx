'use client'
import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

// A procedural, fully customizable bobblehead fighter. Because it's built from
// primitives, everything is tweakable at runtime: skin tone (material color),
// hair (swappable geometry) and hair color (incl. a rainbow gradient). Used for
// player / PvP characters. Idle sway + head bobble; punches on attackKey bump.

export type HairStyle = 'none' | 'short' | 'long'
export interface FighterLook {
  party: 'democrat' | 'republican' | null
  skin: string
  hairStyle: HairStyle
  hairColor: string // hex, or 'rainbow'
}

export const SKIN_TONES = ['#f6d5b8', '#e8b98e', '#cf9a6b', '#a9744f', '#7a4f33', '#4a2f1e']
export const HAIR_COLORS = ['#141414', '#4a2f1b', '#c9a24b', '#b23b2e', '#8b8f94', '#ececec', '#6a4bd6']
export const RAINBOW = 'rainbow'
export const HAIR_STYLES: HairStyle[] = ['none', 'short', 'long']

function partyColors(party: FighterLook['party']) {
  return party === 'democrat'
    ? { shirt: '#2563eb', pants: '#1e3a8a' }
    : party === 'republican'
    ? { shirt: '#dc2626', pants: '#7f1d1d' }
    : { shirt: '#6b7280', pants: '#374151' }
}

function useRainbowTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 4; c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 64)
    ;['#ff2d2d', '#ff9e2d', '#ffe62d', '#37d84a', '#2d9bff', '#8b5cff'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col))
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64)
    const t = new THREE.CanvasTexture(c)
    t.needsUpdate = true
    return t
  }, [])
}

function Hair({ style, color, rainbow }: { style: HairStyle; color: string; rainbow: THREE.Texture }) {
  const mat = color === RAINBOW
    ? <meshStandardMaterial map={rainbow} roughness={0.6} />
    : <meshStandardMaterial color={color} roughness={0.65} />
  if (style === 'none') return null
  return (
    <group>
      {/* cap over the crown, sits just above the face */}
      <mesh position={[0, 0.16, -0.02]} scale={[1.06, 0.85, 1.06]}>
        <sphereGeometry args={[0.5, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        {mat}
      </mesh>
      {style === 'long' && (
        <>
          {/* back curtain */}
          <mesh position={[0, -0.16, -0.28]} rotation={[0.18, 0, 0]}>
            <boxGeometry args={[0.62, 0.72, 0.16]} />
            {mat}
          </mesh>
          {/* side strands */}
          <mesh position={[-0.42, -0.1, 0.02]}>
            <boxGeometry args={[0.14, 0.6, 0.4]} />
            {mat}
          </mesh>
          <mesh position={[0.42, -0.1, 0.02]}>
            <boxGeometry args={[0.14, 0.6, 0.4]} />
            {mat}
          </mesh>
        </>
      )}
    </group>
  )
}

function Fighter({ look, attackKey }: { look: FighterLook; attackKey: number }) {
  const { shirt, pants } = partyColors(look.party)
  const rainbow = useRainbowTexture()
  const body = useRef<THREE.Group>(null!)
  const headPivot = useRef<THREE.Group>(null!)
  const rArm = useRef<THREE.Group>(null!)
  const punchStart = useRef(-10)
  const prevKey = useRef(0)
  const skinMat = <meshStandardMaterial color={look.skin} roughness={0.85} />

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (attackKey > 0 && attackKey !== prevKey.current) { prevKey.current = attackKey; punchStart.current = t }
    // idle sway + bob
    if (body.current) {
      body.current.rotation.z = Math.sin(t * 1.6) * 0.04
      body.current.position.y = Math.sin(t * 2.2) * 0.02
    }
    // bobble head (springy)
    if (headPivot.current) {
      headPivot.current.rotation.z = Math.sin(t * 3.4) * 0.09 - Math.sin(t * 1.6) * 0.06
      headPivot.current.rotation.x = Math.cos(t * 2.7) * 0.06
    }
    // punch: right arm swings forward toward the camera, then returns
    if (rArm.current) {
      const e = t - punchStart.current
      const p = e >= 0 && e < 0.45 ? Math.sin((e / 0.45) * Math.PI) : 0
      rArm.current.rotation.x = -0.1 - p * 2.2
    }
  })

  return (
    <group ref={body} position={[0, 0, 0]}>
      {/* legs */}
      <mesh position={[-0.16, 0.28, 0]}><cylinderGeometry args={[0.13, 0.13, 0.56, 16]} /><meshStandardMaterial color={pants} roughness={0.8} /></mesh>
      <mesh position={[0.16, 0.28, 0]}><cylinderGeometry args={[0.13, 0.13, 0.56, 16]} /><meshStandardMaterial color={pants} roughness={0.8} /></mesh>
      {/* torso */}
      <mesh position={[0, 0.86, 0]}><capsuleGeometry args={[0.34, 0.42, 8, 20]} /><meshStandardMaterial color={shirt} roughness={0.75} /></mesh>
      {/* left arm (static) */}
      <group position={[-0.42, 1.06, 0]} rotation={[-0.1, 0, 0.15]}>
        <mesh position={[0, -0.28, 0]}><capsuleGeometry args={[0.1, 0.44, 6, 12]} /><meshStandardMaterial color={shirt} roughness={0.75} /></mesh>
        <mesh position={[0, -0.58, 0]}>{skinMat}<sphereGeometry args={[0.13, 16, 16]} /></mesh>
      </group>
      {/* right arm (punches) — pivots at the shoulder */}
      <group ref={rArm} position={[0.42, 1.06, 0]} rotation={[-0.1, 0, -0.15]}>
        <mesh position={[0, -0.28, 0]}><capsuleGeometry args={[0.1, 0.44, 6, 12]} /><meshStandardMaterial color={shirt} roughness={0.75} /></mesh>
        <mesh position={[0, -0.58, 0]}>{skinMat}<sphereGeometry args={[0.13, 16, 16]} /></mesh>
      </group>
      {/* oversized bobble head */}
      <group ref={headPivot} position={[0, 1.28, 0]}>
        <group position={[0, 0.42, 0]}>
          <mesh>{skinMat}<sphereGeometry args={[0.5, 32, 28]} /></mesh>
          {/* eyes */}
          <mesh position={[-0.17, 0.05, 0.44]}><sphereGeometry args={[0.06, 12, 12]} /><meshStandardMaterial color="#1b1b1b" /></mesh>
          <mesh position={[0.17, 0.05, 0.44]}><sphereGeometry args={[0.06, 12, 12]} /><meshStandardMaterial color="#1b1b1b" /></mesh>
          {/* smile */}
          <mesh position={[0, -0.16, 0.44]} rotation={[0, 0, Math.PI]}><torusGeometry args={[0.13, 0.025, 8, 16, Math.PI]} /><meshStandardMaterial color="#7c2d2d" /></mesh>
          <Hair style={look.hairStyle} color={look.hairColor} rainbow={rainbow} />
        </group>
      </group>
    </group>
  )
}

export default function BobbleFighter({ look, attackKey = 0, orbit = false }: { look: FighterLook; attackKey?: number; orbit?: boolean }) {
  return (
    <Canvas style={{ width: '100%', height: '100%' }} camera={{ position: [0, 1.15, 3.1], fov: 40 }}
      dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 6, 4]} intensity={1.5} />
      <directionalLight position={[-4, 2, 3]} intensity={0.5} color="#cfd8ff" />
      <Suspense fallback={null}>
        <Fighter look={look} attackKey={attackKey} />
        <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={4} blur={2.4} far={2} />
      </Suspense>
      {orbit && <OrbitControls enablePan={false} minDistance={2} maxDistance={5} target={[0, 1.05, 0]} />}
    </Canvas>
  )
}

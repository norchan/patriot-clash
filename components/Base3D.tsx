'use client'
import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Billboard, useTexture, useGLTF, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import {
  GRID, HQ_PAD, PRINT_SHOP_PAD,
  hqImage, safeImage, barracksImage, solarImage, turretImage,
} from '@/config/house'

// Building types that have a real Meshy-generated GLB in
// public/models/buildings/<type>.glb. Types NOT listed fall back to the
// painted sprite billboard. Populated as models are generated + eyeballed.
const GLB_TYPES = new Set<string>([
  'hq', 'print_shop', 'media_tower', 'safe', 'barracks', 'solar', 'turret', 'doberman', 'fence',
])
const glbUrl = (type: string) => `/models/buildings/${type}.glb`

// ── 3D BASE (Michael 2026-09-05: "an Unreal-engine version of the base").
// A real 3D lot — orbiting camera, sunlit ground, soft contact shadows —
// rendered from the SAME data model as the 2D yard (config/house.ts). The
// buildings reuse the existing painted art as upright, camera-facing planes
// (Y-axis billboards) planted on the grid, so nothing new has to be modeled
// to get the 3D scene standing. Real GLB building meshes drop in later as a
// straight swap of BuildingSprite → <primitive object={gltf}>.

export interface Base3DBuilding { pad: number; type: string; level: number; facing?: number; damaged?: boolean }

const CELL = 2.2          // world units between grid cells
const HALF = (GRID - 1) / 2
// pad → world (x,z), centered on the lot
function padXZ(pad: number): [number, number] {
  const col = pad % GRID, row = Math.floor(pad / GRID)
  return [(col - HALF) * CELL, (row - HALF) * CELL]
}

// sprite src + on-lot footprint width (world units), by building type
const ART: Record<string, { src: (l: number) => string; w: number }> = {
  fence: { src: () => '/house/fence2.webp', w: 1.3 },
  media_tower: { src: () => '/house/media_tower.webp', w: 2.2 },
  safe: { src: l => safeImage(l), w: 1.7 },
  barracks: { src: l => barracksImage(l), w: 2.6 },
  solar: { src: l => solarImage(l), w: 2.3 },
  doberman: { src: () => '/house/doberman.webp', w: 1.8 },
  turret: { src: l => turretImage(l), w: 2.0 },
}

// One building: the painted sprite on a plane, upright, always facing the
// camera around Y, feet on the ground, with a soft round blob shadow.
function BuildingSprite({ src, x, z, w, mirror, damaged }: {
  src: string; x: number; z: number; w: number; mirror?: boolean; damaged?: boolean
}) {
  const tex = useTexture(src)
  tex.colorSpace = THREE.SRGBColorSpace
  const img = tex.image as HTMLImageElement | undefined
  const aspect = img && img.width ? img.height / img.width : 1.25
  const h = w * aspect
  return (
    <group position={[x, 0, z]}>
      {/* blob shadow on the ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[w * 0.42, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <Billboard position={[0, h / 2, 0]} lockX lockZ>
        <mesh scale={[mirror ? -1 : 1, 1, 1]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={tex} transparent alphaTest={0.5} side={THREE.DoubleSide}
            color={damaged ? '#6b5a4a' : '#ffffff'}
          />
        </mesh>
      </Billboard>
    </group>
  )
}

// A real 3D building mesh (Meshy GLB), self-normalized: scaled so its
// footprint matches the grid slot, feet dropped to the ground, centered.
function BuildingGLB({ type, x, z, w, mirror, damaged }: {
  type: string; x: number; z: number; w: number; mirror?: boolean; damaged?: boolean
}) {
  const { scene } = useGLTF(glbUrl(type))
  const obj = useMemo(() => {
    const clone = scene.clone(true)
    const box = new THREE.Box3().setFromObject(clone)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const footprint = Math.max(size.x, size.z) || 1
    const s = w / footprint
    clone.scale.setScalar(s)
    clone.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    clone.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true
        if (damaged) {
          const mat = (m.material as THREE.MeshStandardMaterial)?.clone?.()
          if (mat) { mat.color?.multiplyScalar?.(0.45); m.material = mat }
        }
      }
    })
    return clone
  }, [scene, w, damaged])
  return <group position={[x, 0, z]} scale={[mirror ? -1 : 1, 1, 1]}><primitive object={obj} /></group>
}

// The grass lot — the yard background stretched over a plane, softly framed.
function Ground() {
  const tex = useTexture('/house/yard_bg2.webp')
  tex.colorSpace = THREE.SRGBColorSpace
  const size = GRID * CELL + 3
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  )
}

export default function Base3D({ buildings, hqLevel, printShopPad }: {
  buildings: Base3DBuilding[]
  hqLevel: number
  printShopPad: number
}) {
  // build the placement list once
  const placed = useMemo(() => {
    const items: { key: string; type: string; src: string; x: number; z: number; w: number; mirror?: boolean; damaged?: boolean }[] = []
    const [hx, hz] = padXZ(HQ_PAD)
    items.push({ key: 'hq', type: 'hq', src: hqImage(hqLevel), x: hx, z: hz, w: 3.4 })
    const [px, pz] = padXZ(printShopPad ?? PRINT_SHOP_PAD)
    items.push({ key: 'ps', type: 'print_shop', src: '/house/print_shop.webp', x: px, z: pz, w: 2.3 })
    for (const b of buildings) {
      const a = ART[b.type]
      if (!a) continue
      const [x, z] = padXZ(b.pad)
      items.push({ key: `b${b.pad}`, type: b.type, src: a.src(b.level), x, z, w: a.w, mirror: ((b.facing ?? 0) % 2) === 1, damaged: b.damaged })
    }
    return items
  }, [buildings, hqLevel, printShopPad])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 13, 17], fov: 40 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0b1310']} />
      <fog attach="fog" args={['#0b1310', 26, 46]} />
      <hemisphereLight args={['#dfe6ff', '#3a4a35', 0.7]} />
      <directionalLight
        position={[8, 16, 6]} intensity={1.35} castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-16} shadow-camera-right={16}
        shadow-camera-top={16} shadow-camera-bottom={-16}
      />
      <Suspense fallback={null}>
        <Ground />
        {placed.map(p => (
          GLB_TYPES.has(p.type)
            ? <BuildingGLB key={p.key} type={p.type} x={p.x} z={p.z} w={p.w} mirror={p.mirror} damaged={p.damaged} />
            : <BuildingSprite key={p.key} src={p.src} x={p.x} z={p.z} w={p.w} mirror={p.mirror} damaged={p.damaged} />
        ))}
        <ContactShadows position={[0, 0.03, 0]} scale={GRID * CELL + 4} blur={2.4} opacity={0.4} far={12} />
      </Suspense>
      <OrbitControls
        target={[0, 1.2, 0]}
        minDistance={8} maxDistance={30}
        maxPolarAngle={Math.PI / 2.15}
        autoRotate autoRotateSpeed={0.4}
        enablePan
        makeDefault
      />
    </Canvas>
  )
}

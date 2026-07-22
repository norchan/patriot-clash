'use client'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Rigged + animated enemy (Meshy). Loads two GLBs that share one skeleton:
//   <prefix>_idle.glb / <prefix>_throw.glb
// Oversized head with a gentle bobble (bobblehead), idle at rest, plays the
// throw when the battle bumps `attackKey`. The character's OWN throwable
// (emoji or item art) sits in its throwing hand through idle and the windup,
// vanishes at the release frame (the DOM projectile takes over), then
// "reloads" after the follow-through. `onReady` fires once the model is
// in-scene so the caller can hide the 2D fallback.

export interface FoeItem { emoji?: string; img?: string }

// emoji / item art → sprite texture (canvas-drawn for emoji)
function useItemTexture(item?: FoeItem) {
  return useMemo(() => {
    if (!item) return null
    if (item.img) {
      const tex = new THREE.TextureLoader().load(item.img)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    }
    if (!item.emoji) return null
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')!
    ctx.font = '200px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(item.emoji, 128, 140)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [item?.emoji, item?.img]) // eslint-disable-line react-hooks/exhaustive-deps
}

const HEAD_SCALE = 1.4 // oversized bobble head — funny, not overdone

function Model({ prefix, faceY, attackKey, item, onReady }: { prefix: string; faceY: number; attackKey: number; item?: FoeItem; onReady?: () => void }) {
  const idleGltf = useGLTF(`/models/${prefix}_idle.glb`)
  const throwGltf = useGLTF(`/models/${prefix}_throw.glb`)
  const scene = idleGltf.scene
  const root = useRef<THREE.Group>(null!)
  const fit = useRef<THREE.Group>(null!)
  const held = useRef<THREE.Sprite>(null!)
  const itemTex = useItemTexture(item)
  const throwPending = useRef(false)
  const launchAt = useRef(-1)
  const prevKey = useRef(0)

  const head = useMemo(() => scene.getObjectByName('Head') ?? null, [scene])
  // same closed-fist fix as PvP: the meshes have flat open hands baked in
  const handL = useMemo(() => scene.getObjectByName('LeftHand') ?? null, [scene])
  const handR = useMemo(() => scene.getObjectByName('RightHand') ?? null, [scene])
  // toe bones — the anim clips carry root motion that lifts the character off
  // the floor, so we re-ground the feet every frame against these
  const toeL = useMemo(() => scene.getObjectByName('LeftToeBase') ?? null, [scene])
  const toeR = useMemo(() => scene.getObjectByName('RightToeBase') ?? null, [scene])
  const toeTargetY = useRef<number | null>(null)
  const vA = useMemo(() => new THREE.Vector3(), [])
  const vB = useMemo(() => new THREE.Vector3(), [])
  const vC = useMemo(() => new THREE.Vector3(), [])

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

  // onReady lives in a ref so the measurement effect below NEVER re-runs from
  // a parent re-render. Re-measuring mid-animation was re-grounding the model
  // to a random pose height every timer tick — sprites drifted into the sky.
  const onReadyRef = useRef(onReady)
  useEffect(() => { onReadyRef.current = onReady })

  useLayoutEffect(() => {
    // drei caches GLTF scenes: bones still hold the LAST battle's pose, so a
    // remount would measure a random animation frame (the "some sprites are
    // too small" variance). Snapshot every bone's loaded local transform the
    // first time, restore it before measuring on every mount after.
    // (NOT skeleton.pose() — it ignores armature node scaling on these rigs.)
    if (!scene.userData._restSaved) {
      scene.userData._restSaved = true
      scene.traverse(o => {
        if ((o as THREE.Bone).isBone) o.userData._rest = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }
      })
    }
    scene.traverse(o => {
      const r = o.userData._rest
      if ((o as THREE.Bone).isBone && r) { o.position.copy(r.p); o.quaternion.copy(r.q); o.scale.copy(r.s) }
    })
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    let s = 2.5 / (size.y || 1) // headroom above: arms-overhead throw poses must not clip the frame top
    const applyFit = () => {
      if (!fit.current) return
      fit.current.scale.setScalar(s)
      fit.current.position.set(-center.x * s, -box.min.y * s, -center.z * s)
      scene.updateMatrixWorld(true)
    }
    applyFit()
    // The runtime HEAD_SCALE (1.4×) extends the head far above the bind bbox —
    // on chibi rigs (Policy Wonk) the scaled head towers past the frame top and
    // gets cut flat above the eyes. Estimate the scaled head top and shrink the
    // whole model until it clears SAFE_TOP (leaving room for throw poses too).
    if (head) {
      const SAFE_TOP = 1.35 // world y; frame top at z=0 is ~2.09 — big margin so hats/hair survive throw poses (canvas box grew to compensate size)
      const GROUND = -0.95
      const headY = head.getWorldPosition(vA).y
      const headLen = Math.max(0, (GROUND + size.y * s) - headY)
      const effTop = headY + HEAD_SCALE * headLen
      if (effTop > SAFE_TOP) {
        s *= (SAFE_TOP - GROUND) / (effTop - GROUND)
        applyFit()
      }
    }
    // remember where the toes sit in the bind pose (soles on the ground) so
    // the per-frame grounding knows the target height — measured ONCE
    if (toeL && toeR) {
      toeTargetY.current = Math.min(toeL.getWorldPosition(vA).y, toeR.getWorldPosition(vB).y)
    }
    onReadyRef.current?.()
  }, [scene, head, toeL, toeR, vA, vB])

  useEffect(() => { idleAction?.reset().play() }, [idleAction])

  useEffect(() => {
    if (attackKey <= 0 || attackKey === prevKey.current || !throwAction) return
    prevKey.current = attackKey
    // proper crossfades (not fade-out+fade-in) — no mid-blend pose snap
    throwAction.reset().play()
    if (idleAction) throwAction.crossFadeFrom(idleAction, 0.18, false)
    throwPending.current = true
    const onFinished = (e: any) => {
      if (e.action !== throwAction) return
      if (idleAction) { idleAction.reset().play(); idleAction.crossFadeFrom(throwAction, 0.3, false) }
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  }, [attackKey, mixer, idleAction, throwAction])

  useFrame((state, dt) => {
    mixer.update(dt)
    if (root.current) root.current.rotation.y = faceY
    // GROUND LOCK: cancel the clips' vertical root motion — feet stay planted
    // through idle AND throw (no hover, no launch-up during attacks)
    if (toeTargetY.current !== null && toeL && toeR && fit.current) {
      const minToeY = Math.min(toeL.getWorldPosition(vA).y, toeR.getWorldPosition(vB).y)
      fit.current.position.y += toeTargetY.current - minToeY
    }
    const t = state.clock.elapsedTime
    // Oversized head — scale only. NO additive rotation "bobble": on rigs
    // whose clips don't animate the head bone, `rotation +=` accumulates and
    // the head tumbles into the torso (the headless-sprite bug).
    if (head) head.scale.setScalar(HEAD_SCALE)
    // closed fists (squash the open-paddle hands, like the PvP fighters)
    if (handL) handL.scale.set(1.2, 0.45, 1.2)
    if (handR) handR.scale.set(1.2, 0.45, 1.2)
    // The held throwable rides the throwing hand — through idle sway AND the
    // windup — then vanishes at the release frame (~0.35s into the throw clip,
    // when the DOM projectile spawns) and "reloads" after the follow-through.
    if (throwPending.current) { launchAt.current = t; throwPending.current = false }
    if (held.current) {
      const e = launchAt.current > 0 ? t - launchAt.current : Infinity
      const released = e > 0.35 && e < 1.15
      const hand = handR ?? handL
      if (hand && itemTex && !released) {
        hand.getWorldPosition(vC)
        held.current.parent?.worldToLocal(vC)
        held.current.position.set(vC.x, vC.y + 0.06, vC.z + 0.05)
        held.current.visible = true
      } else held.current.visible = false
    }
  })

  return (
    // ground at -0.95: deep models (flared dresses) stay inside the frame's
    // nearer perspective planes instead of clipping at the canvas bottom
    <group position={[0, -0.95, 0]}>
      <group ref={root}><group ref={fit}><primitive object={scene} /></group></group>
      {itemTex && (
        <sprite ref={held} visible={false} scale={[0.5, 0.5, 0.5]}>
          <spriteMaterial map={itemTex} transparent depthWrite={false} />
        </sprite>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[1.05, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.46} />
      </mesh>
    </group>
  )
}

export default function Enemy3D({ prefix, faceY = 0, attackKey = 0, item, onReady }: { prefix: string; faceY?: number; attackKey?: number; item?: FoeItem; onReady?: () => void }) {
  return (
    <Canvas frameloop="always" style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0.4, 4.4], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      {/* warm street-fire key + cool night rim to match the battle backdrop */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 6, 4]} intensity={2.0} color="#ffd6a0" />
      <directionalLight position={[-4, 2, -3]} intensity={0.8} color="#6a8bff" />
      <pointLight position={[0, 1, 3]} intensity={0.5} color="#ffb877" />
      <Suspense fallback={null}>
        <Model prefix={prefix} faceY={faceY} attackKey={attackKey} item={item} onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload('/models/comrade_idle.glb')
useGLTF.preload('/models/comrade_throw.glb')

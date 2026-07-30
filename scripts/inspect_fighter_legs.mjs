// Leg/foot audit for the sprite fighters (Michael 2026-07-29: "good ole boys
// pants are messy. feet too. The prosperity pastor's feet ... look like they
// have platforms under them. check all of the pvp sprites legs for issues").
//
// Loads each merged fighter GLB and measures, in the REST pose, the things that
// actually produce those complaints:
//   · a base/plinth — Meshy image-to-3D often welds a slab under the character,
//     which reads exactly as "platforms under the feet"
//   · feet that overlap or merge into each other
//   · a foot that floats above, or sinks below, the mesh's own floor
//   · leg bones whose skinned geometry is wildly off from the bone position
//     (the "messy pants" signature — stray verts weighted to the wrong bone)
//
// Everything is reported in MODEL units and again as a % of the character's
// height, because the arena scales every fighter to a fixed height.
//
// LIMITS — READ BEFORE TRUSTING A CLEAN RESULT. On 2026-07-29 this reported
// all 22 fighters clean while two of them were visibly broken. It only sees
// STRUCTURE (extra primitives, bone positions, bounds). It cannot see baked
// texture mess, skinning weights, or clothing welded between the legs — and
// those are what actually look wrong. It ruled out the plinth theory, which
// was worth doing, and that is about the extent of it.
//
// The tool that finds real problems is scripts/leg_audit.mjs (renders each
// fighter, optionally mid-animation, so you can LOOK). Deformation only shows
// up in motion: run it with CLIP=kickhi AT=0.62.
//
// Usage: node scripts/inspect_fighter_legs.mjs [id...]   (default: all)

import { NodeIO } from '@gltf-transform/core'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(process.cwd())
const MODELS = path.join(ROOT, 'public', 'models')

// party suffix per fighter id, read from the catalog so this can't drift
const cat = fs.readFileSync(path.join(ROOT, 'config', 'fighters.ts'), 'utf8')
const FIGHTERS = [...cat.matchAll(/id:\s*'([^']+)'[^}]*?party:\s*'(democrat|republican)'/g)]
  .map(m => ({ id: m[1], file: `${m[1]}_${m[2] === 'democrat' ? 'dem' : 'rep'}.glb` }))

const want = process.argv.slice(2)
const list = want.length ? FIGHTERS.filter(f => want.includes(f.id)) : FIGHTERS

const io = new NodeIO()

/** World-space transform of a node by walking up its parents. */
function worldMatrix(node) {
  const chain = []
  let n = node
  while (n) { chain.unshift(n); n = n.getParentNode?.() ?? null }
  // compose TRS manually (column-major 4x4)
  let m = ident()
  for (const c of chain) m = mul(m, trs(c.getTranslation(), c.getRotation(), c.getScale()))
  return m
}
const ident = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
function trs(t, q, s) {
  const [x,y,z,w] = q
  const x2=x+x, y2=y+y, z2=z+z
  const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2, wx=w*x2, wy=w*y2, wz=w*z2
  return [
    (1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
    (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
    (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
    t[0], t[1], t[2], 1,
  ]
}
function mul(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]
  return o
}
const pos = m => [m[12], m[13], m[14]]

const rows = []
for (const { id, file } of list) {
  const p = path.join(MODELS, file)
  if (!fs.existsSync(p)) { console.log(`✗ ${id}: no ${file}`); continue }
  const doc = await io.read(p)
  const root = doc.getRoot()

  // ── bounds of every mesh primitive, and per-primitive so we can spot a slab
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  const prims = []
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const acc = prim.getAttribute('POSITION')
      if (!acc) continue
      const min = acc.getMin([]), max = acc.getMax([])
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], min[i]); hi[i] = Math.max(hi[i], max[i]) }
      prims.push({ name: mesh.getName() || '(unnamed)', min, max, count: acc.getCount() })
    }
  }
  const H = hi[1] - lo[1]
  const pct = v => `${((v / H) * 100).toFixed(1)}%`

  // ── foot bones in the rest pose
  const bones = {}
  for (const node of root.listNodes()) {
    const n = node.getName()
    if (/^(LeftFoot|RightFoot|LeftToeBase|RightToeBase|LeftLeg|RightLeg|LeftUpLeg|RightUpLeg|Hips)$/.test(n)) {
      bones[n] = pos(worldMatrix(node))
    }
  }
  const issues = []

  // 1. BASE / PLINTH: a primitive that is wide in X/Z but paper-thin in Y and
  //    sits at the very bottom is a pedestal, not a character.
  for (const pr of prims) {
    const h = pr.max[1] - pr.min[1]
    const w = Math.max(pr.max[0] - pr.min[0], pr.max[2] - pr.min[2])
    const atFloor = pr.min[1] - lo[1] < H * 0.02
    if (atFloor && h < H * 0.06 && w > H * 0.15) {
      issues.push(`BASE/PLINTH: "${pr.name}" ${pct(h)} tall, ${pct(w)} wide, sitting on the floor`)
    }
  }

  // 2. FEET MERGED: horizontal gap between the two foot bones
  if (bones.LeftFoot && bones.RightFoot) {
    const dx = Math.abs(bones.LeftFoot[0] - bones.RightFoot[0])
    const dz = Math.abs(bones.LeftFoot[2] - bones.RightFoot[2])
    const gap = Math.hypot(dx, dz)
    if (gap < H * 0.03) issues.push(`FEET MERGED: foot bones only ${pct(gap)} apart`)
    // 3. UNEVEN: one foot markedly higher than the other in the rest pose
    const dy = Math.abs(bones.LeftFoot[1] - bones.RightFoot[1])
    if (dy > H * 0.02) issues.push(`FEET UNEVEN: ${pct(dy)} height difference between feet`)
  }

  // 4. FLOATING / SUNK: lowest foot bone vs the mesh floor. A foot bone sits a
  //    little above the sole, so a big gap means the mesh extends well below
  //    the skeleton — the other way a "platform" shows up.
  const footY = [bones.LeftToeBase?.[1], bones.RightToeBase?.[1], bones.LeftFoot?.[1], bones.RightFoot?.[1]]
    .filter(v => typeof v === 'number')
  if (footY.length) {
    const drop = Math.min(...footY) - lo[1]
    if (drop > H * 0.09) issues.push(`MESH BELOW FEET: ${pct(drop)} of geometry hangs under the lowest foot bone`)
  }

  rows.push({ id, H: H.toFixed(3), prims: prims.length, issues, bones, lo, hi })
  const tag = issues.length ? '⚠' : '✔'
  console.log(`${tag} ${id.padEnd(20)} h=${H.toFixed(2)}  prims=${String(prims.length).padStart(2)}  ${issues.length ? issues.join(' | ') : 'clean'}`)
}

const bad = rows.filter(r => r.issues.length)
console.log(`\n${rows.length} fighters · ${bad.length} with findings`)
if (bad.length) console.log('flagged: ' + bad.map(r => r.id).join(', '))

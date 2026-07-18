// HAIR POKE-THROUGH FIX (offline, idempotent): in every fighter GLB, fully
// reweight all vertices whose BIND position is above the jaw line to the Head
// bone. Long hair was partially weighted to neck/Spine/Shoulders, so it kept
// floating when the head was squashed for a custom bobble head. After this,
// squashing Head collapses the entire head+hair region, and with no custom
// head the hair swings rigidly with the bobble.
// Bind pose is A-pose: hands are below jaw height, so arms are never touched.
// Run: node scripts/fix_hair_weights.mjs   (safe to re-run; processes all
// existing fighter GLBs including newly generated kick clips)
import fs from 'fs'
import { NodeIO } from '@gltf-transform/core'
const io = new NodeIO()

const files = fs.readdirSync('public/models')
  .filter(f => /^fighter\d+_(dem|rep)_(punch|jabL|kickhi|kicklo|block|hit|guard)\.glb$/.test(f))

let changedTotal = 0
for (const f of files) {
  const path = `public/models/${f}`
  const doc = await io.read(path)
  const root = doc.getRoot()
  const skin = root.listSkins()[0]
  if (!skin) { console.log(`${f}: no skin, skip`); continue }
  const joints = skin.listJoints().map(j => j.getName())
  const headIdx = joints.indexOf('Head')
  if (headIdx < 0) { console.log(`${f}: no Head joint, skip`); continue }
  let changed = 0
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posA = prim.getAttribute('POSITION')
      const jntA = prim.getAttribute('JOINTS_0')
      const wgtA = prim.getAttribute('WEIGHTS_0')
      if (!posA || !jntA || !wgtA) continue
      const pos = posA.getArray()
      const jnt = jntA.getArray().slice()
      const wgt = wgtA.getArray().slice()
      const n = posA.getCount()
      // jaw line: lowest Y of strongly-Head-weighted vertices + 10% of the
      // head's height (same heuristic the probe validated on all rigs)
      let headMinY = Infinity, maxY = -Infinity
      for (let i = 0; i < n; i++) {
        const y = pos[i * 3 + 1]
        if (y > maxY) maxY = y
        for (let k = 0; k < 4; k++) if (jnt[i * 4 + k] === headIdx && wgt[i * 4 + k] > 0.5 && y < headMinY) headMinY = y
      }
      if (!isFinite(headMinY)) continue
      const cut = headMinY + (maxY - headMinY) * 0.1
      for (let i = 0; i < n; i++) {
        if (pos[i * 3 + 1] <= cut) continue
        const alreadyPure = jnt[i * 4] === headIdx && wgt[i * 4] === 1 && wgt[i * 4 + 1] === 0 && wgt[i * 4 + 2] === 0 && wgt[i * 4 + 3] === 0
        if (alreadyPure) continue
        jnt[i * 4] = headIdx; jnt[i * 4 + 1] = 0; jnt[i * 4 + 2] = 0; jnt[i * 4 + 3] = 0
        wgt[i * 4] = 1; wgt[i * 4 + 1] = 0; wgt[i * 4 + 2] = 0; wgt[i * 4 + 3] = 0
        changed++
      }
      jntA.setArray(jnt)
      wgtA.setArray(wgt)
    }
  }
  if (changed > 0) await io.write(path, doc)
  console.log(`${f}: ${changed} verts reweighted`)
  changedTotal += changed
}
console.log(`DONE — ${changedTotal} vertices across ${files.length} files`)

// MERGE FIGHTER CLIPS (Michael 2026-07-28): every fighter shipped as SIX GLBs
// — punch/jabL/kickhi/kicklo/block/hit — and each one carried a full copy of
// the same 18k-vert mesh + texture. The animation is <4% of the file, so ~96%
// of the download was duplicate geometry (7.8 MB/fighter instead of ~1.4 MB).
//
// This merges each fighter into ONE <prefix>.glb whose animations are NAMED
// for their clip, retargeting every channel onto the base file's skeleton by
// bone name. PvpArena3D looks clips up by name instead of loading six files.
//
//   node scripts/merge_fighter_clips.mjs           # every fighter found
//   node scripts/merge_fighter_clips.mjs don_rep   # just one
//
// Originals are left in place; delete them once the merged files are verified.
import fs from 'fs'
import { NodeIO } from '@gltf-transform/core'
import { dedup, prune } from '@gltf-transform/functions'

const DIR = 'public/models'
const CLIPS = ['punch', 'jabL', 'kickhi', 'kicklo', 'block', 'hit']
const BASE = 'jabL' // its guard frame doubles as the idle pose in the arena
const io = new NodeIO()

// every prefix that has a full six-clip set
const prefixes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR)
      .filter(f => f.endsWith('_punch.glb'))
      .map(f => f.replace('_punch.glb', ''))
      .filter(p => CLIPS.every(c => fs.existsSync(`${DIR}/${p}_${c}.glb`)))

let before = 0, after = 0
for (const prefix of prefixes) {
  const files = Object.fromEntries(CLIPS.map(c => [c, `${DIR}/${prefix}_${c}.glb`]))
  const srcBytes = CLIPS.reduce((n, c) => n + fs.statSync(files[c]).size, 0)

  const doc = await io.read(files[BASE])
  const buffer = doc.getRoot().listBuffers()[0]
  const nodeByName = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]))

  // the base file's own animation becomes the BASE clip, renamed
  const baseAnims = doc.getRoot().listAnimations()
  baseAnims.forEach((a, i) => a.setName(i === 0 ? BASE : `${BASE}_${i}`))

  let addedChannels = 0, skippedChannels = 0
  for (const clip of CLIPS) {
    if (clip === BASE) continue
    const other = await io.read(files[clip])
    const srcAnim = other.getRoot().listAnimations()[0]
    if (!srcAnim) { console.warn(`  ! ${prefix}/${clip}: no animation, skipped`); continue }

    const anim = doc.createAnimation(clip)
    for (const ch of srcAnim.listChannels()) {
      const targetName = ch.getTargetNode()?.getName()
      const node = targetName ? nodeByName.get(targetName) : null
      if (!node) { skippedChannels++; continue } // bone missing from the base rig
      const s = ch.getSampler()
      const inA = s.getInput(), outA = s.getOutput()
      if (!inA || !outA) { skippedChannels++; continue }
      const input = doc.createAccessor()
        .setArray(inA.getArray()).setType(inA.getType()).setBuffer(buffer)
      const output = doc.createAccessor()
        .setArray(outA.getArray()).setType(outA.getType()).setBuffer(buffer)
      const sampler = doc.createAnimationSampler()
        .setInput(input).setOutput(output).setInterpolation(s.getInterpolation())
      const channel = doc.createAnimationChannel()
        .setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sampler)
      anim.addSampler(sampler).addChannel(channel)
      addedChannels++
    }
  }

  // collapse anything identical that survived the copy
  await doc.transform(dedup(), prune())

  const dest = `${DIR}/${prefix}.glb`
  await io.write(dest, doc)
  const outBytes = fs.statSync(dest).size
  before += srcBytes; after += outBytes
  const names = doc.getRoot().listAnimations().map(a => a.getName()).join(', ')
  console.log(`✔ ${prefix}: ${(srcBytes / 1e6).toFixed(1)} MB → ${(outBytes / 1e6).toFixed(2)} MB`
    + `  [${names}]${skippedChannels ? ` (${skippedChannels} channels dropped)` : ''}`)
}

console.log(`\n${prefixes.length} fighters: ${(before / 1e6).toFixed(0)} MB → ${(after / 1e6).toFixed(0)} MB`
  + `  (${Math.round((1 - after / before) * 100)}% smaller)`)
console.log('Originals kept. Run scripts/merge_fighter_clips.mjs --prune-old after verifying in-game.')

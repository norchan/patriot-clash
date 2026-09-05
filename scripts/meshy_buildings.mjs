// 3D building meshes (Michael 2026-09-05): turn each base building's painted
// art into a real GLB via Meshy image-to-3D, for the 3D base (/hq/3d). One
// representative mesh per building TYPE (reused across levels for now).
// Art goes in as a PNG data URI so format/hosting never matters. Resumable
// (skips existing GLBs). Texture-compressed like the fighter pipeline.
//   node scripts/meshy_buildings.mjs
import fs from 'fs'
import sharp from 'sharp'
import { NodeIO } from '@gltf-transform/core'
import { textureCompress } from '@gltf-transform/functions'

const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const API = 'https://api.meshy.ai/openapi/v1'
const H = { Authorization: `Bearer ${env.MESHY_API_KEY}`, 'Content-Type': 'application/json' }
const io = new NodeIO()
const sleep = ms => new Promise(r => setTimeout(r, ms))

// type → representative source art (a mid/high level that reads well in 3D)
const BUILDINGS = [
  ['hq', 'public/house/hq3.webp'],
  ['print_shop', 'public/house/print_shop.webp'],
  ['media_tower', 'public/house/media_tower.webp'],
  ['safe', 'public/house/safe3.webp'],
  ['barracks', 'public/house/barracks3.webp'],
  ['solar', 'public/house/solar2.webp'],
  ['turret', 'public/house/turret2.webp'],
  ['doberman', 'public/house/doberman.webp'],
  ['fence', 'public/house/fence2.webp'],
]

fs.mkdirSync('public/models/buildings', { recursive: true })
const results = { done: [], failed: [] }

for (const [tag, src] of BUILDINGS) {
  const dest = `public/models/buildings/${tag}.glb`
  if (fs.existsSync(dest)) { console.log(`SKIP ${tag}`); continue }
  if (!fs.existsSync(src)) { console.error(`missing art ${src}`); results.failed.push(tag); continue }
  try {
    // art → PNG on a transparent field → data URI
    const png = await sharp(src).resize({ width: 768, withoutEnlargement: true }).png().toBuffer()
    const dataUri = `data:image/png;base64,${png.toString('base64')}`

    const r = await fetch(`${API}/image-to-3d`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        image_url: dataUri,
        enable_pbr: true,
        should_remesh: true,
        should_texture: true,
        ai_model: 'meshy-5',
      }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(`POST ${r.status}: ${JSON.stringify(j).slice(0, 200)}`)
    const taskId = j.result
    let url = null
    for (let i = 0; i < 180; i++) {
      const s = await (await fetch(`${API}/image-to-3d/${taskId}`, { headers: H })).json()
      if (s.status === 'SUCCEEDED') { url = s.model_urls?.glb; break }
      if (s.status === 'FAILED' || s.status === 'CANCELED') throw new Error(`${s.status}: ${JSON.stringify(s.task_error ?? {})}`)
      process.stdout.write(`\r  ${tag}: ${s.status} ${s.progress ?? 0}%   `)
      await sleep(5000)
    }
    if (!url) throw new Error('timed out with no glb url')
    fs.writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()))
    // texture-compress so the base doesn't ship huge GLBs
    try {
      const doc = await io.read(dest)
      await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024] }))
      await io.write(dest, doc)
    } catch (e) { console.warn(`\n  ${tag}: compress skipped (${e.message})`) }
    console.log(`\n✔ ${tag}.glb saved (${Math.round(fs.statSync(dest).size / 1024)}KB)`)
    results.done.push(tag)
  } catch (e) {
    console.error(`\n✗ ${tag} FAILED: ${e.message}`)
    results.failed.push(tag)
  }
}
console.log('DONE:', JSON.stringify(results))

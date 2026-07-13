// Meshy pipeline: image → rigged → animated GLBs (texture-compressed), saved to
// public/models/<prefix>_<name>.glb.
// Usage: node scripts/meshy_pipeline.mjs <imagePath> <outPrefix> [id:name,id:name...]
//   e.g. node scripts/meshy_pipeline.mjs public/enemies/democrat/comrade.png comrade 0:idle,421:throw
import fs from 'fs'
import { NodeIO } from '@gltf-transform/core'
import { textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const KEY = env.MESHY_API_KEY
const API = 'https://api.meshy.ai/openapi/v1'
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const io = new NodeIO()

const [imagePath, outPrefix, actionsArg] = process.argv.slice(2)
const actions = (actionsArg || '0:idle,421:throw').split(',').map(s => { const [id, name] = s.split(':'); return { id: Number(id), name } })

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`POST ${path} ${r.status}: ${JSON.stringify(j)}`)
  return j.result
}
async function poll(path, id, label) {
  for (let i = 0; i < 180; i++) {
    const r = await fetch(`${API}${path}/${id}`, { headers: H })
    const j = await r.json()
    if (j.status === 'SUCCEEDED') { process.stdout.write(`\n`); return j }
    if (j.status === 'FAILED' || j.status === 'CANCELED') throw new Error(`${label} ${j.status}: ${JSON.stringify(j.task_error ?? j)}`)
    process.stdout.write(`\r  ${label}: ${j.status} ${j.progress ?? 0}%     `)
    await sleep(5000)
  }
  throw new Error(`${label} timed out`)
}
async function download(url, dest) {
  const r = await fetch(url)
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}
async function compress(path) {
  const doc = await io.read(path)
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024] }))
  await io.write(path, doc)
}

const log = {}
try {
  // 1. image → 3D (t-pose so the auto-rigger gets a clean humanoid)
  const img = fs.readFileSync(new URL('../' + imagePath, import.meta.url))
  const dataUri = `data:image/png;base64,${img.toString('base64')}`
  console.log(`1/3 image-to-3d (${imagePath})...`)
  const i3dId = await post('/image-to-3d', {
    image_url: dataUri, ai_model: 'meshy-5', pose_mode: 't-pose',
    should_texture: true, target_formats: ['glb'],
  })
  log.image_task = i3dId
  await poll('/image-to-3d', i3dId, 'model')

  // 2. auto-rig
  console.log('2/3 rigging...')
  const rigId = await post('/rigging', { input_task_id: i3dId, height_meters: 1.8 })
  log.rig_task = rigId
  await poll('/rigging', rigId, 'rig')

  // 3. animations → download + texture-compress
  log.animations = {}
  for (const a of actions) {
    console.log(`3/3 animation ${a.name} (action_id ${a.id})...`)
    const anId = await post('/animations', { rig_task_id: rigId, action_id: a.id })
    const an = await poll('/animations', anId, a.name)
    const url = an.result?.animation_glb_url ?? an.animation_glb_url
    if (!url) { console.log('   NO glb url:', JSON.stringify(an).slice(0, 300)); continue }
    const dest = `public/models/${outPrefix}_${a.name}.glb`
    await download(url, dest)
    await compress(dest)
    log.animations[a.name] = { task: anId, bytes: fs.statSync(dest).size }
    console.log(`   ${dest} saved (${fs.statSync(dest).size} bytes)`)
  }
  console.log('\nDONE:', JSON.stringify(log))
} catch (e) {
  console.error('\nPIPELINE ERROR:', e.message)
  console.error('progress so far:', JSON.stringify(log))
  process.exit(1)
}

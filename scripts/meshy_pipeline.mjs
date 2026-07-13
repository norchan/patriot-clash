// Meshy pipeline: image → rigged → animated GLBs, saved to public/models/.
// Usage: node scripts/meshy_pipeline.mjs <imagePath> <outPrefix> [id:name,id:name...]
//   e.g. node scripts/meshy_pipeline.mjs public/enemies/democrat/comrade.png comrade 0:idle,421:throw
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const KEY = env.MESHY_API_KEY
const API = 'https://api.meshy.ai/openapi/v1'
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

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
  const b = Buffer.from(await r.arrayBuffer())
  fs.writeFileSync(dest, b)
  return b.length
}

const log = {}
try {
  // 1. image → 3D (t-pose so the auto-rigger has a clean humanoid)
  const img = fs.readFileSync(new URL('../' + imagePath, import.meta.url))
  const dataUri = `data:image/png;base64,${img.toString('base64')}`
  console.log(`1/3 image-to-3d (${imagePath})...`)
  const i3dId = await post('/image-to-3d', {
    image_url: dataUri, ai_model: 'meshy-5', pose_mode: 't-pose',
    should_texture: true, target_formats: ['glb'],
  })
  log.image_task = i3dId
  const i3d = await poll('/image-to-3d', i3dId, 'model')
  if (i3d.model_urls?.glb) { await download(i3d.model_urls.glb, `public/models/${outPrefix}_base.glb`); console.log('   base glb saved') }

  // 2. auto-rig
  console.log('2/3 rigging...')
  const rigId = await post('/rigging', { input_task_id: i3dId, height_meters: 1.8 })
  log.rig_task = rigId
  const rig = await poll('/rigging', rigId, 'rig')
  const riggedUrl = rig.result?.rigged_character_glb_url ?? rig.rigged_character_glb_url
  if (riggedUrl) { await download(riggedUrl, `public/models/${outPrefix}_rigged.glb`); console.log('   rigged glb saved') }

  // 3. animations
  log.animations = {}
  for (const a of actions) {
    console.log(`3/3 animation ${a.name} (action_id ${a.id})...`)
    const anId = await post('/animations', { rig_task_id: rigId, action_id: a.id })
    const an = await poll('/animations', anId, a.name)
    const url = an.result?.animation_glb_url ?? an.animation_glb_url
    if (url) { const n = await download(url, `public/models/${outPrefix}_${a.name}.glb`); log.animations[a.name] = { task: anId, bytes: n }; console.log(`   ${outPrefix}_${a.name}.glb saved (${n} bytes)`) }
    else console.log('   NO glb url:', JSON.stringify(an).slice(0, 300))
  }
  console.log('\nDONE:', JSON.stringify(log))
} catch (e) {
  console.error('\nPIPELINE ERROR:', e.message)
  console.error('progress so far:', JSON.stringify(log))
  process.exit(1)
}

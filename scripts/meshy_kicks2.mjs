// HEAD KICK (218 Step_in_High_Kick) + LEG KICK (211 Boxing_Guard_Step_Knee_Strike)
// for all 12 fighter variants → public/models/<tag>_{kickhi,kicklo}.glb
// (texture-compressed). Render-approved vs Michael's reference photos.
// Resumable: skips existing files. Run: node scripts/meshy_kicks2.mjs
import fs from 'fs'
import { NodeIO } from '@gltf-transform/core'
import { textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'

const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const API = 'https://api.meshy.ai/openapi/v1'
const H = { Authorization: `Bearer ${env.MESHY_API_KEY}`, 'Content-Type': 'application/json' }
const io = new NodeIO()

const RIGS = [
  ['fighter1_dem', '019f6169-e1e5-7fbd-b80f-a2af8526807b'],
  ['fighter1_rep', '019f616d-2b26-7078-9cea-8330195967bc'],
  ['fighter2_dem', '019f6170-46aa-74ed-975f-ec09e375ac97'],
  ['fighter2_rep', '019f6173-769d-7cd5-b695-f5af275ed5c2'],
  ['fighter3_dem', '019f6176-ea3b-78a0-aa3f-7189b94068fc'],
  ['fighter3_rep', '019f617a-8340-796f-96b1-3b01334607b3'],
  ['fighter4_dem', '019f617e-1f2b-7b44-9957-68eaab0f692a'],
  ['fighter4_rep', '019f6181-5027-733a-b22b-5eac8ff653ab'],
  ['fighter5_dem', '019f6184-7087-7d74-9429-abf904b77fca'],
  ['fighter5_rep', '019f6187-3246-733f-a9b5-f84209118787'],
  ['fighter6_dem', '019f618a-65c7-75ed-97e1-4075b40daf3d'],
  ['fighter6_rep', '019f618d-96c5-7188-859a-8b265634b6a2'],
]
const ACTIONS = [[218, 'kickhi'], [211, 'kicklo']]
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = { done: [], failed: [] }

async function compress(dest) {
  const doc = await io.read(dest)
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024] }))
  await io.write(dest, doc)
}

// fighter1_rep already has trial GLBs — just compress + rename those
for (const [action, name] of ACTIONS) {
  const trial = `public/models/trial_${action === 218 ? 'hi218' : 'lo211'}.glb`
  const dest = `public/models/fighter1_rep_${name}.glb`
  if (fs.existsSync(trial) && !fs.existsSync(dest)) {
    fs.copyFileSync(trial, dest)
    await compress(dest)
    console.log(`fighter1_rep_${name} from trial (${fs.statSync(dest).size})`)
  }
}

for (const [tag, rig] of RIGS) {
  for (const [action, name] of ACTIONS) {
    const dest = `public/models/${tag}_${name}.glb`
    if (fs.existsSync(dest)) { console.log(`SKIP ${tag}_${name}`); continue }
    try {
      const r = await fetch(`${API}/animations`, { method: 'POST', headers: H, body: JSON.stringify({ rig_task_id: rig, action_id: action }) })
      const j = await r.json()
      if (!r.ok) throw new Error(`POST ${r.status}: ${JSON.stringify(j)}`)
      let url = null
      for (let i = 0; i < 120; i++) {
        const s = await (await fetch(`${API}/animations/${j.result}`, { headers: H })).json()
        if (s.status === 'SUCCEEDED') { url = s.result?.animation_glb_url ?? s.animation_glb_url; break }
        if (s.status === 'FAILED' || s.status === 'CANCELED') throw new Error(s.status)
        await sleep(5000)
      }
      if (!url) throw new Error('no glb url')
      fs.writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()))
      await compress(dest)
      console.log(`${tag}_${name} saved (${fs.statSync(dest).size})`)
      results.done.push(`${tag}_${name}`)
    } catch (e) { console.error(`${tag}_${name} FAILED: ${e.message}`); results.failed.push(`${tag}_${name}`) }
  }
}
console.log('KICKS2 COMPLETE:', JSON.stringify(results))

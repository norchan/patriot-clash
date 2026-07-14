// Add a Combat_Stance (action 89) animation to each fighter's existing rig →
// fighterN_stance.glb (texture-compressed). Used as the focused resting loop in
// PvP instead of the casual Idle (which sways/looks around).
import fs from 'fs'
import { NodeIO } from '@gltf-transform/core'
import { textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const API = 'https://api.meshy.ai/openapi/v1'
const H = { Authorization: `Bearer ${env.MESHY_API_KEY}`, 'Content-Type': 'application/json' }
const io = new NodeIO()

const RIGS = [
  ['fighter1', '019f5d89-5dac-7135-adec-cdf6da1de1d2'],
  ['fighter2', '019f5d8d-c711-7bba-93f6-bc704da8a7c0'],
  ['fighter3', '019f5d96-ff0a-71c1-882b-c90291880788'],
  ['fighter4', '019f5d9d-b75f-735a-862e-22efa70bb649'],
  ['fighter5', '019f5da1-186f-70d8-932a-5fc9a8dcbcab'],
  ['fighter6', '019f5da3-d433-716b-9f3c-505fc4e7b2fe'],
]
const STANCE = 89

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = { done: [], failed: [] }
for (const [id, rig] of RIGS) {
  try {
    const r = await fetch(`${API}/animations`, { method: 'POST', headers: H, body: JSON.stringify({ rig_task_id: rig, action_id: STANCE }) })
    const j = await r.json()
    if (!r.ok) throw new Error(`POST ${r.status}: ${JSON.stringify(j)}`)
    const tid = j.result
    let url = null
    for (let i = 0; i < 120; i++) {
      const s = await (await fetch(`${API}/animations/${tid}`, { headers: H })).json()
      if (s.status === 'SUCCEEDED') { url = s.result?.animation_glb_url ?? s.animation_glb_url; break }
      if (s.status === 'FAILED' || s.status === 'CANCELED') throw new Error(`${s.status}: ${JSON.stringify(s.task_error ?? s)}`)
      process.stdout.write(`\r  ${id} stance: ${s.status} ${s.progress ?? 0}%    `)
      await sleep(5000)
    }
    if (!url) throw new Error('no glb url')
    const dest = `public/models/${id}_stance.glb`
    fs.writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()))
    const doc = await io.read(dest)
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024] }))
    await io.write(dest, doc)
    console.log(`\n${id}: stance saved (${fs.statSync(dest).size} bytes)`) ; results.done.push(id)
  } catch (e) { console.error(`\n${id} FAILED: ${e.message}`); results.failed.push(id) }
}
console.log('STANCE COMPLETE:', JSON.stringify(results))

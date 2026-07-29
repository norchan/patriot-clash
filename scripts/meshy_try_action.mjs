// Generate ONE Meshy action onto an existing rig so we can eyeball it in the
// kick harness before committing credits to the whole roster.
//   node scripts/meshy_try_action.mjs <rigTaskId> <actionId> <outName>
// → public/models/<outName>.glb
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
const sleep = ms => new Promise(r => setTimeout(r, ms))

const [rig, action, outName] = process.argv.slice(2)
if (!rig || !action || !outName) { console.error('usage: <rigTaskId> <actionId> <outName>'); process.exit(1) }

const post = await fetch(`${API}/animations`, {
  method: 'POST', headers: H, body: JSON.stringify({ rig_task_id: rig, action_id: Number(action) }),
})
const pj = await post.json()
if (!post.ok) { console.error('POST failed:', JSON.stringify(pj)); process.exit(1) }
const id = pj.result

let url = null, name = ''
for (let i = 0; i < 150; i++) {
  const s = await (await fetch(`${API}/animations/${id}`, { headers: H })).json()
  if (s.status === 'SUCCEEDED') { url = s.result?.animation_glb_url ?? s.animation_glb_url; name = s.result?.action_name ?? s.action_name ?? ''; break }
  if (s.status === 'FAILED' || s.status === 'CANCELED') { console.error('task', s.status, JSON.stringify(s.task_error ?? '')); process.exit(1) }
  process.stdout.write(`\r  ${s.status} ${s.progress ?? 0}%   `)
  await sleep(4000)
}
if (!url) { console.error('\nno glb url'); process.exit(1) }

const dest = `public/models/${outName}.glb`
fs.writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()))
const io = new NodeIO()
const doc = await io.read(dest)
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024] }))
await io.write(dest, doc)
const anims = doc.getRoot().listAnimations().map(a => a.getName())
console.log(`\n✔ ${dest}  action ${action}${name ? ` (${name})` : ''}  clips: ${anims.join(', ')}`)

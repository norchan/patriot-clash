// Renders the kick harness headlessly at a series of clip times so we can SEE
// where a kick actually lands (and read the foot height off the page title).
//   node scripts/kick_shot.mjs [clip] [t1,t2,...] [pitchRadians]
import http from 'http'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

const ROOT = path.resolve('c:/Users/Micha/patriot-clash') // resolve → OS separators, or the guard below rejects everything on Windows
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' }
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0])
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(4599, r))

const clip = process.argv[2] || 'kicklo'
const times = (process.argv[3] || '0.3,0.6,0.9,1.2,1.5').split(',').map(Number)
const pitch = process.argv[4] || '0'
const bone = process.argv[5] || 'RightUpLeg'
const axis = process.argv[6] || 'x'
const fighter = process.argv[7] || 'don_rep'
const gap = process.argv[8] || '0.9'
const outDir = `${ROOT}/.kickshots`
fs.mkdirSync(outDir, { recursive: true })

const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1100, height: 800 } })
p.on('console', m => { if (m.type() === 'error') console.log('  page error:', m.text().slice(0, 160)) })
p.on('response', r => { if (r.status() >= 400) console.log(`  ${r.status()} ${r.url()}`) })
p.on('pageerror', e => console.log('  JS:', String(e).slice(0, 200)))
for (const t of times) {
  const url = `http://localhost:4599/scripts/kick_harness.html?clip=${clip}&t=${t}&pitch=${pitch}&bone=${bone}&axis=${axis}&f=${fighter}&gap=${gap}`
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  await new Promise(r => setTimeout(r, 1200))
  const title = await p.title()
  const out = `${outDir}/${fighter}_${clip}_t${String(t).replace('.', 'p')}${pitch !== '0' ? `_pitch${pitch}` : ''}.png`
  await p.screenshot({ path: out })
  console.log(`${clip} t=${t} pitch=${pitch}  ${title}  → ${path.basename(out)}`)
}
await b.close(); server.close()

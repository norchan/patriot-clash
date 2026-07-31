// Batch leg/foot screenshots for every sprite fighter, plus a contact-sheet
// montage so they can be compared side by side.
//   node scripts/leg_audit.mjs [view] [id...]      view = legs | full
import http from 'http'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

const ROOT = path.resolve('c:/Users/Micha/patriot-clash')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' }
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0])
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(4601, r))

const cat = fs.readFileSync(path.join(ROOT, 'config', 'fighters.ts'), 'utf8')
const ALL = [...cat.matchAll(/id:\s*'([^']+)'[^}]*?party:\s*'(democrat|republican)'/g)]
  .map(m => ({ id: m[1], file: `${m[1]}_${m[2] === 'democrat' ? 'dem' : 'rep'}` }))

const view = ['legs', 'full'].includes(process.argv[2]) ? process.argv[2] : 'legs'
const want = process.argv.slice(['legs', 'full'].includes(process.argv[2]) ? 3 : 2)
const list = want.length ? ALL.filter(f => want.includes(f.id)) : ALL

const outDir = path.join(ROOT, '.legaudit')
fs.mkdirSync(outDir, { recursive: true })

const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 460, height: 460 } })
p.on('pageerror', e => console.log('  JS:', String(e).slice(0, 160)))
p.on('response', r => { if (r.status() >= 400) console.log(`  ${r.status()} ${r.url()}`) })

const clip = process.env.CLIP || ''
const at = process.env.AT || '0'
// ROT=90 renders the profile the arena actually shows. Use it for any kick —
// front-on, a forward kick aims at the lens and reads as a smear even when the
// mesh is fine (Michael's pastor, 2026-07-30).
const rot = process.env.ROT || '0'
for (const f of list) {
  await p.goto(`http://localhost:4601/scripts/leg_audit.html?f=${f.file}&view=${view}&clip=${clip}&t=${at}&rot=${rot}`, { waitUntil: 'networkidle', timeout: 60000 })
  await p.waitForFunction(() => window.__done === true, { timeout: 30000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 250))
  const out = path.join(outDir, `${view}_${f.id}.png`)
  await p.screenshot({ path: out })
  console.log(`${f.id.padEnd(20)} ${await p.title()}`)
}
await b.close(); server.close()
console.log(`\n→ ${outDir}`)

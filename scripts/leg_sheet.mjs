// Contact sheet of the leg shots so all 22 fighters can be compared at once.
//   node scripts/leg_sheet.mjs [view]     view = legs | full
import http from 'http'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

const ROOT = path.resolve('c:/Users/Micha/patriot-clash')
const view = process.argv[2] || 'legs'
const dir = path.join(ROOT, '.legaudit')
const shots = fs.readdirSync(dir).filter(f => f.startsWith(`${view}_`) && f.endsWith('.png'))

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0])
  const file = path.join(ROOT, rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'text/html' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(4602, r))

const cells = shots.map(f => {
  const id = f.replace(`${view}_`, '').replace('.png', '')
  return `<figure><img src="/.legaudit/${f}"><figcaption>${id}</figcaption></figure>`
}).join('')
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#15161a;font:600 15px system-ui;color:#eee;padding:10px}
.g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
figure{margin:0}img{width:100%;display:block;border-radius:5px}
figcaption{text-align:center;padding:4px 0 2px;font-size:14px}
</style><div class="g">${cells}</div>`
fs.writeFileSync(path.join(dir, '_sheet.html'), html)

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1900, height: 1200 } })
await p.goto(`http://localhost:4602/.legaudit/_sheet.html`, { waitUntil: 'networkidle' })
const out = path.join(dir, `_sheet_${view}.png`)
await p.screenshot({ path: out, fullPage: true })
await b.close(); server.close()
console.log(`${shots.length} shots → ${out}`)

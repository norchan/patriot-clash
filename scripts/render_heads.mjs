// Render HEAD CUTOUTS from the roster's 3D models -> public/heads/{id}.png.
// Transparent background, camera aimed at the Head bone, clipping plane just
// below the chin so only the head renders. Adding a future head = drop its
// model in and rerun (or just add a transparent PNG directly).
// Usage: node scripts/render_heads.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import puppeteer from 'puppeteer'; import sharp from 'sharp'
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const IDS = ['politician','cowboy','hick','ice_agent','soldier_boy','preppy','influencer','oil_baron','billionaire',
  'comrade','crazy_liberal','crying_liberal','dem_politician','purple_hair','protestor','anchor','palestine','drag','senator']
const MIME = { '.glb': 'model/gltf-binary', '.js': 'text/javascript', '.html': 'text/html' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(req.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res) })
await new Promise(r => server.listen(8099, r)); const B = 'http://localhost:8099'
const html = `<!doctype html><meta charset=utf8>
<script type="importmap">{"imports":{"three":"${B}/node_modules/three/build/three.module.js","three/addons/":"${B}/node_modules/three/examples/jsm/"}}</script>
<canvas id=c width=640 height=640></canvas><script type=module>
import * as THREE from 'three'; import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
window.head = async (url) => {
 const canvas = document.getElementById('c')
 const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
 r.setSize(640, 640, false); r.setClearColor(0x000000, 0)
 r.outputColorSpace = THREE.SRGBColorSpace; r.localClippingEnabled = true
 const sc = new THREE.Scene()
 sc.add(new THREE.AmbientLight(0xffffff, 1.0))
 const k = new THREE.DirectionalLight(0xffeecc, 1.6); k.position.set(2, 4, 5); sc.add(k)
 const rim = new THREE.DirectionalLight(0xaabbff, 0.7); rim.position.set(-4, 2, -3); sc.add(rim)
 const g = await new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej))
 const root = g.scene
 if (g.animations[0]) { const mx = new THREE.AnimationMixer(root); const a = mx.clipAction(g.animations[0]); a.play(); a.paused = true; a.time = 0.3; mx.update(0.001) }
 sc.add(root); root.updateMatrixWorld(true)
 let bone = null; root.traverse(o => { if (o.isBone && o.name === 'Head') bone = bone || o })
 if (!bone) return 'NO HEAD BONE'
 const p = new THREE.Vector3(); bone.getWorldPosition(p)
 // model height to scale the framing
 const box = new THREE.Box3().setFromObject(root); const size = new THREE.Vector3(); box.getSize(size)
 const headSpan = size.y * 0.30 // generous head region for bobble models
 // clip everything below the chin so ONLY the head renders
 const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(p.y - size.y * 0.015))
 sc.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.clippingPlanes = [clip]; o.material.clipShadows = true } })
 const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
 cam.position.set(p.x, p.y + headSpan * 0.42, p.z + headSpan * 3.8)
 cam.lookAt(p.x, p.y + headSpan * 0.38, p.z)
 r.render(sc, cam); return 'ok'
}
window.__ready = true</script>`
fs.writeFileSync(path.join(ROOT, '__heads.html'), html)
const br = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] })
const pg = await br.newPage(); await pg.setViewport({ width: 320, height: 320, deviceScaleFactor: 2 })
pg.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text()) })
await pg.goto(`${B}/__heads.html`, { waitUntil: 'networkidle0' }); await pg.waitForFunction('window.__ready === true', { timeout: 15000 })
fs.mkdirSync(path.join(ROOT, 'public/heads'), { recursive: true })
for (const id of IDS) {
  const res = await pg.evaluate((u) => window.head(u), `${B}/public/models/${id}_idle.glb`)
  if (res !== 'ok') { console.log(id, 'SKIP:', res); continue }
  await new Promise(r => setTimeout(r, 120))
  const raw = path.join(ROOT, `__head_raw.png`)
  await (await pg.$('#c')).screenshot({ path: raw, omitBackground: true })
  // trim transparent edges, resize to 256 tall
  await sharp(raw).trim({ threshold: 8 }).resize({ height: 256, fit: 'inside' }).png().toFile(path.join(ROOT, `public/heads/${id}.png`))
  console.log('saved', id)
}
fs.rmSync(path.join(ROOT, '__head_raw.png'), { force: true })
await br.close(); server.close(); fs.unlinkSync(path.join(ROOT, '__heads.html')); console.log('DONE')

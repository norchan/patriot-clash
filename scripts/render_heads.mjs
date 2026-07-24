// Render HEAD CUTOUTS from the roster's 3D models -> public/heads/{id}.png.
// Transparent background, camera aimed at the Head bone, clipping plane just
// below the chin so only the head renders. Adding a future head = drop its
// model in and rerun (or just add a transparent PNG directly).
// Usage: node scripts/render_heads.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import puppeteer from 'puppeteer'; import sharp from 'sharp'
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const IDS = ['politician','cowboy','hick','ice_agent','soldier_boy','preppy','influencer','oil_baron','billionaire',
  'comrade','crazy_liberal','crying_liberal','dem_politician','purple_hair','protestor','anchor','palestine','drag','senator',
  'tampon_tim','dan_dankas','maine','firebrand','social_bean']
const MIME = { '.glb': 'model/gltf-binary', '.js': 'text/javascript', '.html': 'text/html' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(req.url.split('?')[0]); const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res) })
await new Promise(r => server.listen(8099, r)); const B = 'http://localhost:8099'
const html = `<!doctype html><meta charset=utf8>
<script type="importmap">{"imports":{"three":"${B}/node_modules/three/build/three.module.js","three/addons/":"${B}/node_modules/three/examples/jsm/"}}</script>
<canvas id=c width=640 height=640></canvas><script type=module>
import * as THREE from 'three'; import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
window.head = async (url, rotY, opts) => {
 opts = opts || {}
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
 // BIND POSE (no animation): every rig's rest pose faces dead ahead — no per-clip head tilt
 // collapse the T-pose ARMS so no floating stubs appear beside chibi heads
 for (const n of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftShoulder', 'RightShoulder']) {
   const b = root.getObjectByName(n); if (b) b.scale.setScalar(0.001)
 }
 const spin = new THREE.Group(); spin.add(root); spin.rotation.y = rotY || 0
 sc.add(spin); spin.updateMatrixWorld(true)
 let bone = null; root.traverse(o => { if (o.isBone && o.name === 'Head') bone = bone || o })
 if (!bone) return 'NO HEAD BONE'
 // per-head geometry tweaks (e.g. senator nose depth) applied to the bone
 if (opts.noseSquash) { bone.scale.z = opts.noseSquash; spin.updateMatrixWorld(true) }
 const p = new THREE.Vector3(); bone.getWorldPosition(p)
 // model height to scale the framing
 const box = new THREE.Box3().setFromObject(root); const size = new THREE.Vector3(); box.getSize(size)
 const headSpan = size.y * 0.30 // generous head region for bobble models
 // clip below the chin + beyond the head's width so ONLY the head renders
 // (bind-pose T arms would otherwise leave floating stubs beside chibi heads).
 // JAW LINE is adaptive: at least 55% of the way up from the neck bone to the
 // head bone — collars/ties always sit below the neck bone, so this guarantees
 // ZERO clothing on every rig; the old fixed fraction is kept as a floor.
 let clipY = p.y - size.y * 0.055
 const neckB = root.getObjectByName('neck') || root.getObjectByName('Neck')
 if (neckB) {
   const ny = new THREE.Vector3(); neckB.getWorldPosition(ny)
   clipY = Math.max(clipY, ny.y + (p.y - ny.y) * (0.55 + (opts.clipLift || 0)))
 }
 const w = size.y * 0.42
 const clips = [
   new THREE.Plane(new THREE.Vector3(0, 1, 0), -clipY),
   new THREE.Plane(new THREE.Vector3(1, 0, 0), -(p.x - w)),
   new THREE.Plane(new THREE.Vector3(-1, 0, 0), (p.x + w)),
 ]
 sc.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.clippingPlanes = clips; o.material.clipShadows = true } })
 const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
 cam.position.set(p.x, p.y + headSpan * 0.45, p.z + headSpan * 5.2)
 cam.lookAt(p.x, p.y + headSpan * 0.42, p.z)
 r.render(sc, cam); return 'ok'
}
window.__ready = true</script>`
fs.writeFileSync(path.join(ROOT, '__heads.html'), html)
const br = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] })
const pg = await br.newPage(); await pg.setViewport({ width: 320, height: 320, deviceScaleFactor: 2 })
pg.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text()) })
await pg.goto(`${B}/__heads.html`, { waitUntil: 'networkidle0' }); await pg.waitForFunction('window.__ready === true', { timeout: 15000 })
fs.mkdirSync(path.join(ROOT, 'public/heads'), { recursive: true })
const ONLY = process.argv[2] // optional single id for testing
// per-head geometry fixes: senator nose depth; clip lifts where the default
// jaw line still catches clothing (odd rig proportions)
const TWEAKS = {
  senator: { noseSquash: 0.82 },
  politician: { clipLift: -0.2 }, // the Don's chin/jowls hang low — drop the jaw line
  oil_baron: { clipLift: 0.35 },
  crazy_liberal: { clipLift: 0.2, chinScrub: { band: 0.09 }, sideRot: Math.PI * 0.22 }, // bob swallowed her face at the default angle
  ice_agent: { sideRot: Math.PI * 0.2 }, // balaclava+goggles ARE the face — default angle showed the back of his skull
}
for (const id of IDS) {
  if (ONLY && id !== ONLY) continue
  // sideRot: per-head shallower side angle for heads whose identity (mask,
  // goggles, hair) turns away from camera at the default 0.36π
  for (const [suffix, rotY] of [['', 0], ['_side', TWEAKS[id]?.sideRot ?? Math.PI * 0.36]]) {
    const res = await pg.evaluate((u, r, o) => window.head(u, r, o), `${B}/public/models/${id}_idle.glb`, rotY, TWEAKS[id] || {})
    if (res !== 'ok') { console.log(id, 'SKIP:', res); continue }
    await new Promise(r => setTimeout(r, 120))
    const raw = path.join(ROOT, `__head_raw.png`)
    await (await pg.$('#c')).screenshot({ path: raw, omitBackground: true })
    // CLEAN EDGES: kill low-alpha fringe/halo pixels (they render as gray
    // dust around the cutout), then trim hard and downscale
    {
      const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 70) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0 }
      }
      // trim FIRST so band math is relative to the head, not the empty canvas
      const trimmed = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .trim({ threshold: 40 }).raw().toBuffer({ resolveWithObject: true })
      // some collars peek out BEHIND the chin, above the clip plane — scrub
      // saturated clothing-colored pixels in the bottom band (per-head opt-in)
      const t = TWEAKS[id] || {}
      if (t.chinScrub) {
        const td = trimmed.data, ti = trimmed.info
        const bandTop = Math.floor(ti.height * (1 - t.chinScrub.band))
        for (let y = bandTop; y < ti.height; y++) for (let x = 0; x < ti.width; x++) {
          const i = (y * ti.width + x) * 4
          const [r2, g2, b2] = [td[i], td[i + 1], td[i + 2]]
          if (r2 > g2 * 1.45 && r2 > b2 * 1.45 && r2 > 90) { td[i + 3] = 0 }
        }
      }
      await sharp(trimmed.data, { raw: { width: trimmed.info.width, height: trimmed.info.height, channels: 4 } })
        .resize({ height: 256, fit: 'inside' }).png()
        .toFile(path.join(ROOT, `public/heads/${id}${suffix}.png`))
    }
    console.log('saved', id + suffix)
  }
}
fs.rmSync(path.join(ROOT, '__head_raw.png'), { force: true })
await br.close(); server.close(); fs.unlinkSync(path.join(ROOT, '__heads.html')); console.log('DONE')

// Re-shoot the OG/Twitter card (public/og.jpg) from the live battle map.
// Straight-on framing: flat mercator (no globe tilt), bearing/pitch 0, tight
// fit on the continental US (Michael: "straighten it out and zoom in a touch").
// Usage: dev server on :3000, then `node scripts/og_shot.mjs`.
// Relies on window.__bmap (capture hook in components/BattleMap.tsx).
import path from 'path'
import { fileURLToPath } from 'url'
import puppeteer from 'puppeteer'
import sharp from 'sharp'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const URL_ = process.argv[2] || 'http://localhost:3000/battlemap'
const OUT = path.join(ROOT, 'public/og.jpg')

const b = await puppeteer.launch({ headless: 'new', args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist'] })
const p = await b.newPage()
await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 })
await p.goto(URL_, { waitUntil: 'networkidle2', timeout: 90000 })
await p.waitForFunction('window.__bmap && window.__bmap.loaded && window.__bmap.loaded()', { timeout: 60000 })

// live town-hall count for the tagline (page header shows "N town halls · live")
const hallCount = await p.evaluate(() => document.body.innerText.match(/([\d,]+) town halls/)?.[1] ?? '2,351')

await p.evaluate(() => {
  const m = window.__bmap
  // isolate + fullscreen the map canvas; hide controls/popups
  const el = m.getContainer()
  const css = document.createElement('style')
  css.textContent = `
    body * { visibility: hidden }
    .mapboxgl-map, .mapboxgl-map * { visibility: visible }
    .mapboxgl-ctrl, .mapboxgl-ctrl-attrib, .mapboxgl-popup { display: none !important; visibility: hidden !important }
  `
  document.head.appendChild(css)
  Object.assign(el.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '9999' })
  document.body.style.overflow = 'hidden'
  m.resize()
  // STRAIGHT US: flat projection kills the globe tilt; fit CONUS with a little
  // extra room at the bottom for the headline strip
  m.setProjection('mercator')
  m.setPitch(0)
  m.setBearing(0)
  m.fitBounds([[-124.8, 24.3], [-66.8, 49.5]], { padding: { top: 24, bottom: 96, left: 24, right: 24 }, animate: false })
})
// let tiles + labels + territory layers settle
await p.evaluate(() => new Promise(r => { const m = window.__bmap; m.once('idle', r); setTimeout(r, 12000) }))
await new Promise(r => setTimeout(r, 2500))

// headline overlay (matches the original card's copy)
await p.evaluate((halls) => {
  const o = document.createElement('div')
  o.id = 'ogov'
  // the isolation CSS hides body * — force every overlay node visible (spans
  // without inline visibility were getting re-hidden, which ate the legend)
  const css = document.createElement('style')
  css.textContent = '#ogov, #ogov * { visibility: visible !important }'
  document.head.appendChild(css)
  o.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;font-family:Arial,Helvetica,sans-serif'
  o.innerHTML = `
    <div style="position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(180deg,transparent, rgba(2,2,8,0.72));visibility:visible"></div>
    <div style="position:absolute;left:44px;bottom:74px;color:#fff;font-weight:900;font-size:84px;letter-spacing:6px;text-shadow:0 4px 18px rgba(0,0,0,0.9);visibility:visible">POLITICSGO</div>
    <div style="position:absolute;left:46px;bottom:34px;color:#dbe2ea;font-weight:700;font-size:30px;text-shadow:0 2px 10px rgba(0,0,0,0.9);visibility:visible">The battle for America&rsquo;s ${halls} town halls</div>
    <div style="position:absolute;right:44px;bottom:34px;display:flex;align-items:center;gap:12px;font-weight:900;font-size:30px;text-shadow:0 2px 10px rgba(0,0,0,0.9);visibility:visible">
      <span style="width:26px;height:26px;border-radius:50%;background:#3b82f6;display:inline-block"></span>
      <span style="color:#93c5fd">Democrats</span>
      <span style="color:#fff">vs</span>
      <span style="width:26px;height:26px;border-radius:50%;background:#ef4444;display:inline-block"></span>
      <span style="color:#fca5a5">GOP</span>
    </div>`
  document.body.appendChild(o)
}, hallCount)
await new Promise(r => setTimeout(r, 400))

const raw = path.join(ROOT, '__og_raw.png')
await p.screenshot({ path: raw })
await sharp(raw).jpeg({ quality: 84 }).toFile(OUT)
await b.close()
const { unlinkSync } = await import('fs')
unlinkSync(raw)
console.log('OG-OK', OUT)

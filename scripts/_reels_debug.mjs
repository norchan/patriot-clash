// Repro the black-video reels bug on live politicsgo.app/p/videos:
// click the first video card, then measure the fullscreen viewer's iframe.
import puppeteer from 'puppeteer'
const b = await puppeteer.launch({ headless: 'new', args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
await p.goto('https://politicsgo.app/p/videos', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 2000))

// tap the first reel card (thumb inside a button)
const clicked = await p.evaluate(() => {
  const img = document.querySelector('button img[src*="ytimg"], button img[src*="tiktok"]')
  const btn = img?.closest('button')
  if (!btn) return false
  btn.click()
  return true
})
console.log('card clicked:', clicked)
await new Promise(r => setTimeout(r, 4000))

const info = await p.evaluate(() => {
  const out = { iframes: [], slides: [], wrap: null }
  for (const f of document.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect()
    const cs = getComputedStyle(f)
    out.iframes.push({ src: f.src.slice(0, 90), w: r.width, h: r.height, x: r.x, y: r.y, display: cs.display, vis: cs.visibility, cls: f.className })
  }
  const wrap = document.querySelector('div.snap-y')
  if (wrap) {
    const wr = wrap.getBoundingClientRect()
    out.wrap = { w: wr.width, h: wr.height, children: wrap.children.length, scrollTop: wrap.scrollTop }
    for (const c of Array.from(wrap.children).slice(0, 3)) {
      const r = c.getBoundingClientRect()
      out.slides.push({ w: r.width, h: r.height, y: r.y, cls: (c.className || '').slice(0, 80) })
    }
  }
  return out
})
console.log(JSON.stringify(info, null, 1))
await p.screenshot({ path: process.argv[2] || 'reels_shot.png' })
await b.close()
console.log('SHOT-OK')

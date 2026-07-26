// Game footage recorder (Michael 2026-07-26): captures phone-portrait
// gameplay clips from the LIVE site's public guest routes for TikTok/promo
// cutting in Premiere. Playwright screencasts → webm, then ffmpeg → mp4.
//
//   node scripts/record_footage.mjs
//
// Output: %USERPROFILE%\Desktop\politicsgo-footage\*.mp4  (1080x1920)
// No audio (screencasts are silent) — music gets added in the edit anyway.

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const SITE = 'https://politicsgo.app'
const MJ12 = '05c3a6d5-3434-4e8d-8ac0-8844d38d872b' // Michael's fighter as the guest-fight opponent
const OUT = join(os.homedir(), 'Desktop', 'politicsgo-footage')
const TMP = join(OUT, '_raw')
mkdirSync(TMP, { recursive: true })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function recordClip(browser, name, run, seconds) {
  console.log(`▶ ${name} (${seconds}s)...`)
  const context = await browser.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir: TMP, size: { width: 1080, height: 1920 } },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await context.newPage()
  let videoPath = null
  try {
    await run(page, seconds)
    videoPath = await page.video()?.path()
  } catch (err) {
    console.error(`  ${name} errored:`, err.message)
    videoPath = await page.video()?.path().catch(() => null)
  }
  await context.close() // finalizes the webm
  if (videoPath) {
    const mp4 = join(OUT, `${name}.mp4`)
    try {
      execFileSync('ffmpeg', ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
        '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-an', mp4], { stdio: 'ignore' })
      console.log(`  ✔ ${mp4}`)
    } catch {
      copyFileSync(videoPath, join(OUT, `${name}.webm`))
      console.log(`  ✔ ${name}.webm (ffmpeg convert failed, kept raw)`)
    }
  }
}

// tap a button by its visible text if it exists — quiet no-op otherwise
async function tap(page, text) {
  try { await page.getByText(text, { exact: false }).first().click({ timeout: 900, force: true }) } catch {}
}

const clips = {
  // 1) the public battle map — slow cinematic pans + zooms
  async battlemap(page, seconds) {
    await page.goto(`${SITE}/battlemap`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
    await sleep(6000) // tiles + markers settle
    const until = Date.now() + seconds * 1000
    while (Date.now() < until) {
      await page.mouse.move(270, 500)
      await page.mouse.wheel(0, -400) // zoom in
      await sleep(2500)
      await page.mouse.down(); await page.mouse.move(170, 420, { steps: 24 }); await page.mouse.up()
      await sleep(2200)
      await page.mouse.wheel(0, -400)
      await sleep(2600)
      await page.mouse.down(); await page.mouse.move(380, 560, { steps: 24 }); await page.mouse.up()
      await sleep(2200)
      await page.mouse.wheel(0, 500) // ease back out
      await sleep(2500)
    }
  },

  // 2) guest PvP vs Michael's fighter — real 3D boxing with inputs
  async pvp_fight(page, seconds) {
    await page.goto(`${SITE}/battle/pvp?guest=1&vs=${MJ12}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await sleep(12000) // models load + 3-2-1 intro
    const until = Date.now() + seconds * 1000
    let i = 0
    while (Date.now() < until) {
      await page.keyboard.press('Space').catch(() => {}) // jab (desktop binding)
      if (i % 3 === 1) await tap(page, '🦵')
      if (i % 4 === 2) await tap(page, '🦶')
      if (i % 5 === 3) await tap(page, '💥')
      if (i % 7 === 5) await tap(page, '★')
      await sleep(650 + Math.random() * 500)
      i++
    }
  },

  // 3) the guest game world (Cahokia) — sprites on the map
  async guest_world(page, seconds) {
    await page.goto(`${SITE}/play`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
    await sleep(6000)
    const until = Date.now() + seconds * 1000
    while (Date.now() < until) {
      await page.mouse.move(270, 480)
      await page.mouse.wheel(0, -350)
      await sleep(2400)
      await page.mouse.down(); await page.mouse.move(200, 380, { steps: 20 }); await page.mouse.up()
      await sleep(2000)
      // poke the middle of the map — might open a sprite tap-menu
      await page.mouse.click(270, 470)
      await sleep(2600)
      await page.keyboard.press('Escape').catch(() => {})
      await sleep(1500)
    }
  },

  // 4) Tet-Kris arcade — falling blocks with live inputs
  async tetkris(page, seconds) {
    await page.goto(`${SITE}/arcade/tetkris`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
    await sleep(3500)
    for (const label of ['PLAY', 'START', 'DEAL', '▶']) await tap(page, label)
    await sleep(1500)
    const until = Date.now() + seconds * 1000
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']
    let i = 0
    while (Date.now() < until) {
      await page.keyboard.press(keys[i % keys.length]).catch(() => {})
      await sleep(420 + Math.random() * 380)
      i++
    }
  },
}

const browser = await chromium.launch({ headless: false }) // headed = real GPU for WebGL
try {
  await recordClip(browser, 'battlemap', clips.battlemap, 30)
  await recordClip(browser, 'pvp_fight', clips.pvp_fight, 40)
  await recordClip(browser, 'guest_world', clips.guest_world, 25)
  await recordClip(browser, 'tetkris', clips.tetkris, 25)
} finally {
  await browser.close()
  rmSync(TMP, { recursive: true, force: true })
}
console.log(`\nDone → ${OUT}`)

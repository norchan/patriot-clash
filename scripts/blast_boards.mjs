// ONE-TIME BLAST (Michael, 2026-07-21): every reporter bot posts ~10 in a row
// to fill the psubs, then normal 6-hour shifts resume. Safe to re-run: the
// cron routes dedupe by link + headline similarity, so each round only posts
// stories the board doesn't already have.
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const BASE = 'https://politicsgo.app/api/cron'
const AUTH = { Authorization: `Bearer ${env.CRON_SECRET}` }

async function hit(path) {
  const t0 = Date.now()
  try {
    const r = await fetch(`${BASE}/${path}`, { headers: AUTH })
    const d = await r.json().catch(() => ({}))
    console.log(`${path} -> ${r.status} in ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(d).slice(0, 160))
    return d
  } catch (e) {
    console.log(`${path} -> FAILED (${e.message})`)
    return null
  }
}

let total = 0
for (let round = 1; round <= 10; round++) {
  console.log(`\n=== ROUND ${round}/10 ===`)
  const phase = round % 2 === 1 ? 1 : 2 // both reporters take turns
  for (const ep of [`team-news?phase=${phase}`, `state-news?phase=${phase}`, `topic-news?phase=${phase}`]) {
    const d = await hit(ep)
    total += d?.inserted ?? 0
  }
  if (round <= 5) {
    const d = await hit('video-reels')
    total += d?.inserted ?? 0
  }
}
console.log(`\nBLAST DONE — ${total} posts inserted`)

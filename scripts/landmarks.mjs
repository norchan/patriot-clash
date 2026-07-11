// Backfills gyms.landmark_url with each town's Wikipedia lead image (the
// city page's photo — usually a genuinely local landmark: main street,
// courthouse, water tower). Cities without a usable page stay null and the
// town hall page falls back to a satellite view.
//
// Usage: node scripts/landmarks.mjs [--force]
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'Washington, D.C.',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function wikiImage(title, attempt = 0) {
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': 'PoliticsGoBot/1.0 (https://politicsgo.app; landmark images)' },
    })
    if (res.status === 429 || res.status === 403) {
      // rate limited — back off hard and retry
      if (attempt >= 4) return null
      await sleep(3000 * (attempt + 1))
      return wikiImage(title, attempt + 1)
    }
    if (!res.ok) return null
    const d = await res.json()
    if (d.type === 'disambiguation') return null
    // thumbnail is ~320px; bump the rendered width to 900 for a hero banner
    let url = d.thumbnail?.source ?? null
    if (url) url = url.replace(/\/(\d+)px-/, '/900px-')
    else if (d.originalimage?.source) url = d.originalimage.source
    return url
  } catch { return null }
}

async function findLandmark(city, state) {
  const stateName = STATE_NAMES[state] ?? state
  return (await wikiImage(`${city}, ${stateName}`))
    ?? (await wikiImage(`${city} (${stateName})`))
    ?? null
}

const force = process.argv.includes('--force')

// page past the 1000-row cap
const gyms = []
for (let page = 0; page < 10; page++) {
  const { data } = await sb.from('gyms')
    .select('id, city_name, state, landmark_url')
    .order('id')
    .range(page * 1000, page * 1000 + 999)
  if (!data?.length) break
  gyms.push(...data)
  if (data.length < 1000) break
}
const todo = gyms.filter(g => force || !g.landmark_url)
console.log(`${gyms.length} halls, ${todo.length} to backfill`)

let found = 0, missed = 0, done = 0
const workers = Array.from({ length: 3 }, async () => {
  while (todo.length) {
    const g = todo.shift()
    await sleep(120) // stay well under Wikipedia's anonymous rate limits
    const url = await findLandmark(g.city_name, g.state)
    if (url) {
      await sb.from('gyms').update({ landmark_url: url }).eq('id', g.id)
      found++
    } else {
      missed++
    }
    done++
    if (done % 200 === 0) console.log(`${done} done (${found} found, ${missed} missed)`)
  }
})
await Promise.all(workers)
console.log(`finished: ${found} landmarks set, ${missed} without (will use satellite fallback)`)

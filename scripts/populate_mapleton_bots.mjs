// Populate Mapleton, MN with resident bots doing bot things (Michael
// 2026-08-24): the standard 12-resident garrison every other hall has —
// meme-card profile pics, fighters, bios — plus a batch of town-flavored
// hall posts so the feed is alive on open. Idempotent. node scripts/populate_mapleton_bots.mjs
import fs from 'fs'
import pg from 'pg'
import { randomUUID } from 'crypto'

const raw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const DATABASE_URL = raw.match(/^DATABASE_URL=(.+)$/m)?.[1].trim()
const c = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const TARGET_RESIDENTS = 12
const pick = a => a[Math.floor(Math.random() * a.length)]

// ── name pools (expand_bots.mjs flavor) ──
const R_PRE = ['Liberty', 'Eagle', 'Patriot', 'Freedom', 'RedRock', 'Cowboy', 'Frontier', 'Homestead', 'Prairie', 'Harvest']
const R_NAME = ['Hank', 'Dale', 'Rex', 'June', 'Tex', 'Grace', 'Otis', 'Wanda', 'Buck', 'Mae']
const D_PRE = ['BlueWave', 'Progress', 'Union', 'Metro', 'Green', 'Canvass', 'Turnout', 'Civic', 'Grassroot', 'MapleRiver']
const D_NAME = ['Betty', 'Joe', 'Pam', 'Carl', 'Mia', 'Cindy', 'Paul', 'Tara', 'Drew', 'Nina']
const BIOS = ['book club member', 'coffee shop regular', 'high school football fan', 'weekend gardener',
  'lifelong Twins fan', 'church choir', 'takes the dog to the park daily', 'grills every Sunday',
  'fixing up an old pickup', 'volunteer at the food shelf', 'plays cards on Thursdays', 'ice fishing in winter']

// ── fighter JSONB (matches the resident shape) ──
const BODIES = ['athletic', 'heavy', 'lean', 'stocky']
const TOPS = ['tank', 'tee', 'hoodie', 'jacket']
const HAIR = ['short', 'buzz', 'afro', 'ponytail', 'bald', 'mullet']
const ARCH = ['striker', 'brawler', 'guardian', 'skirmisher']
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#a9714b', '#8d5524']
const HAIRC = ['#2b2b2b', '#5a3825', '#b8b8b8', '#d9a441', '#111111']
const mkFighter = (party, gender) => ({
  body: pick(BODIES), skin: pick(SKIN), gender,
  topColor: party === 'democrat' ? '#2563eb' : '#dc2626', topStyle: pick(TOPS),
  archetype: pick(ARCH), hairColor: pick(HAIRC), hairStyle: pick(HAIR),
  pantColor: pick(['#1f2937', '#374151', '#4b5563', '#7c2d12']), toneShift: 0,
})

// ── Mapleton-specific, timeless resident posts (cron believability rules:
// no dates, no real names, season-general, <180 chars) ──
const POSTS = [
  'Maple River is running high after all the rain — kids were skipping rocks by the bridge all afternoon.',
  'Main Street coffee spot finally has the pumpkin stuff back. Small town, big line.',
  'Friday night lights are the best thing about this town, dont @ me.',
  'Whoever keeps the flower baskets downtown looking that good deserves a medal.',
  'County fair season means I will be eating my weight in cheese curds again. No regrets.',
  'Grain trucks rolling through on the highway means harvest is here. Slow down out there, folks.',
  'The diner ran out of hotdish by noon. In THIS town? Rookie numbers, chef.',
  'Took the dog around the ballfields at sunset. Nothing beats a quiet evening in Mapleton.',
  'Council meeting had opinions about the new stop sign. Riveting stuff, honestly.',
  'Library book sale is criminally underrated. Walked out with a stack for two bucks.',
]

try {
  const gy = await c.query('SELECT id, latitude, longitude, radius_miles FROM gyms WHERE city_name=$1 AND state=$2', ['Mapleton', 'MN'])
  if (!gy.rows.length) { console.error('Mapleton MN hall not found — run add_mapleton_hall.mjs first'); process.exit(1) }
  const gym = gy.rows[0]

  const have = await c.query("SELECT count(*) n FROM profiles WHERE home_gym_id=$1 AND clerk_user_id LIKE 'bot%'", [gym.id])
  const need = Math.max(0, TARGET_RESIDENTS - Number(have.rows[0].n))
  console.log(`Mapleton residents: ${have.rows[0].n} → adding ${need}`)

  const usedNames = new Set((await c.query('SELECT lower(username) u FROM profiles')).rows.map(r => r.u))
  const mkName = (party) => {
    for (let i = 0; i < 40; i++) {
      const base = party === 'republican' ? pick(R_PRE) + pick(R_NAME) : pick(D_PRE) + pick(D_NAME)
      const cand = i < 20 ? base : base + Math.floor(Math.random() * 900 + 100)
      if (!usedNames.has(cand.toLowerCase())) { usedNames.add(cand.toLowerCase()); return cand }
    }
    return 'Resident' + Math.floor(Math.random() * 1e6)
  }

  const newBotIds = []
  for (let i = 0; i < need; i++) {
    const party = i % 2 === 0 ? 'republican' : 'democrat' // Mapleton holder is red; keep it red-leaning majority via the existing holder + even split here
    const gender = Math.random() < 0.5 ? 'male' : 'female'
    const clerkId = `bot_gen_${randomUUID()}`
    const r = await c.query(
      `INSERT INTO profiles (clerk_user_id, username, party, home_gym_id, onboarded, gender, fp_balance, about_me, avatar_url, fighter)
       VALUES ($1,$2,$3,$4,true,$5,5000,$6,$7,$8) RETURNING id`,
      [clerkId, mkName(party), party, gym.id, gender, pick(BIOS),
        `/api/avatar/meme?seed=${clerkId}`, JSON.stringify(mkFighter(party, gender))])
    newBotIds.push(r.rows[0].id)
  }
  console.log(`✔ ${newBotIds.length} resident bots added (meme-card avatars, fighters, bios)`)

  // ── hall posts: only if Mapleton's feed is empty of bot posts ──
  const existingPosts = await c.query(
    "SELECT count(*) n FROM hall_posts hp JOIN profiles p ON p.id=hp.profile_id WHERE hp.gym_id=$1 AND p.clerk_user_id LIKE 'bot%'", [gym.id])
  if (Number(existingPosts.rows[0].n) > 0) {
    console.log(`· feed already has ${existingPosts.rows[0].n} bot posts — skipping post seed`)
  } else {
    const residents = (await c.query(
      "SELECT id, party FROM profiles WHERE home_gym_id=$1 AND clerk_user_id LIKE 'bot%'", [gym.id])).rows
    let n = 0
    for (const text of POSTS) {
      const author = pick(residents)
      // spread created_at over the past ~40h so the feed doesn't look batch-made
      const agoMin = Math.floor(Math.random() * 40 * 60)
      await c.query(
        `INSERT INTO hall_posts (gym_id, profile_id, party, content, created_at)
         VALUES ($1,$2,$3,$4, now() - ($5 || ' minutes')::interval)`,
        [gym.id, author.id, author.party, text, agoMin])
      n++
    }
    console.log(`✔ ${n} Mapleton hall posts seeded (town-flavored, staggered timestamps)`)
  }

  console.log('DONE')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}

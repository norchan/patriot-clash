// Add a town hall for Mapleton, MN (Michael 2026-08-24). Blue Earth County,
// ~12mi S of Mankato. Bot-garrisoned like every other MN hall: create the
// gym, a resident bot, and set it as holder. Idempotent. One transaction.
// node scripts/add_mapleton_hall.mjs
import fs from 'fs'
import pg from 'pg'
import { randomUUID } from 'crypto'

const raw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const DATABASE_URL = raw.match(/^DATABASE_URL=(.+)$/m)?.[1].trim()
const c = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const HALL = {
  city_name: 'Mapleton', county: 'Blue Earth', state: 'MN',
  population: 1750, lat: 43.9291, lng: -93.9552,
  radius_miles: 5, defense_points: 800, party: 'republican',
}

try {
  await c.query('BEGIN')

  const dup = await c.query('SELECT id FROM gyms WHERE lower(city_name)=lower($1) AND state=$2', [HALL.city_name, HALL.state])
  if (dup.rows.length) { console.log('· Mapleton MN already exists:', dup.rows[0].id); await c.query('ROLLBACK'); process.exit(0) }

  // 1) the hall
  const g = await c.query(
    `INSERT INTO gyms (city_name, county, state, population, location, latitude, longitude,
        radius_miles, defense_points, holder_party, held_since, is_active)
     VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($6,$5),4326), $5,$6, $7,$8,$9, now(), true)
     RETURNING id`,
    [HALL.city_name, HALL.county, HALL.state, HALL.population, HALL.lat, HALL.lng,
      HALL.radius_miles, HALL.defense_points, HALL.party])
  const gymId = g.rows[0].id

  // 2) a resident bot to hold it (same shape as scripts/occupy_all_halls.mjs)
  let username = 'HankBoone' + Math.floor(Math.random() * 900 + 100)
  for (let i = 0; i < 20; i++) {
    const taken = await c.query('SELECT 1 FROM profiles WHERE lower(username)=lower($1)', [username])
    if (!taken.rows.length) break
    username = 'HankBoone' + Math.floor(Math.random() * 900 + 100)
  }
  const b = await c.query(
    `INSERT INTO profiles (clerk_user_id, username, party, home_gym_id, onboarded)
     VALUES ($1,$2,$3,$4,true) RETURNING id`,
    [`bot_gen_${randomUUID()}`, username, HALL.party, gymId])
  const botId = b.rows[0].id

  // 3) garrison it
  await c.query('UPDATE gyms SET holder_id=$1 WHERE id=$2', [botId, gymId])

  await c.query('COMMIT')
  console.log(`✔ Mapleton, MN hall created: ${gymId}`)
  console.log(`  held by bot ${username} (${HALL.party}), defense ${HALL.defense_points}, radius ${HALL.radius_miles}mi`)
} catch (e) {
  await c.query('ROLLBACK')
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}

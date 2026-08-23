// DDL (Grok 2026-08-22): optional profiles.website_url + fix the gender
// check constraint so "no response" (the onboarding route's value) is legal.
// Runs over DATABASE_URL (service pooler) — no SQL editor needed.
// node scripts/add_website_url.mjs
import fs from 'fs'
import pg from 'pg'

const raw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const DATABASE_URL = raw.match(/^DATABASE_URL=(.+)$/m)?.[1].trim()
if (!DATABASE_URL) { console.error('no DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

// 1) optional website_url
await client.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS website_url text`)
console.log('✔ profiles.website_url ensured')

// 2) gender constraint: the /api/profile/onboard route writes 'none' for
//    "no response" but the old CHECK only allowed male|female|null → signup
//    for no-response players 500s. Rebuild it to accept 'none' too (keep NULL).
const { rows } = await client.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'profiles'::regclass AND conname = 'profiles_gender_check'`)
if (rows.length) {
  console.log('  old:', rows[0].def)
  await client.query(`ALTER TABLE profiles DROP CONSTRAINT profiles_gender_check`)
}
await client.query(`
  ALTER TABLE profiles ADD CONSTRAINT profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('male','female','none'))`)
console.log('✔ profiles_gender_check now allows male|female|none|NULL')

await client.end()
console.log('DONE')

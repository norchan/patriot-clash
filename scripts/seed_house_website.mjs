// Seed the two house accounts' website_url (Grok 2026-08-22).
// node scripts/seed_house_website.mjs
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { error, count } = await db.from('profiles')
  .update({ website_url: 'https://politicsgo.app' }, { count: 'exact' })
  .in('username', ['PGODems', 'PGOGOP'])
console.log(error ? 'FAIL ' + error.message : `✔ seeded website_url on ${count} house accounts`)

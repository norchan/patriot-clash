// Ensure real board rows for the party windows (Grok 2026-08-22).
// The party feeds render virtually (resolvePBoard short-circuits democrats/
// republicans to a party window over ALL party posts), but hall_posts has a
// CHECK (gym_id IS NOT NULL OR board_id IS NOT NULL) — a post needs a target.
// These rows give party posts a board_id to satisfy that constraint; the read
// path is unchanged. node scripts/ensure_party_boards.mjs
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const { createClient } = await import('@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

for (const [slug, name] of [['democrats', 'Democrats'], ['republicans', 'Republicans']]) {
  const { data: existing } = await db.from('boards').select('id').eq('slug', slug).maybeSingle()
  if (existing) { console.log(`· ${slug} exists (${existing.id.slice(-6)})`); continue }
  const { data, error } = await db.from('boards').insert({ slug, name, category: 'topic' }).select('id').single()
  console.log(error ? `FAIL ${slug}: ${error.message}` : `✔ ${slug} created (${data.id.slice(-6)})`)
}

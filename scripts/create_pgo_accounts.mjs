// Create the two official party accounts (Grok/Michael 2026-08-22):
//   PGODems  / democrat   / dems@politicsgo.net
//   PGOGOP   / republican / gop@politicsgo.net
// Clerk user via Backend API + Supabase profile upsert, fully onboarded
// (party + gender + onboarded=true) so they never hit the onboarding wall
// and can post immediately. Idempotent: safe to re-run.
// node scripts/create_pgo_accounts.mjs
import fs from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const ACCOUNTS = [
  { username: 'PGODems', email: 'dems@politicsgo.net', party: 'democrat' },
  { username: 'PGOGOP', email: 'gop@politicsgo.net', party: 'republican' },
]

async function clerk(path, opts = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
  })
  const j = await res.json()
  return { ok: res.ok, status: res.status, body: j }
}

for (const a of ACCOUNTS) {
  // 1) find-or-create the Clerk user
  const q = await clerk(`/users?email_address=${encodeURIComponent(a.email)}`)
  let user = Array.isArray(q.body) && q.body.length ? q.body[0] : null
  let password = null
  if (!user) {
    password = crypto.randomBytes(12).toString('base64url') + '!Pg7'
    let r = await clerk('/users', {
      method: 'POST',
      body: JSON.stringify({ email_address: [a.email], username: a.username, password }),
    })
    if (!r.ok && JSON.stringify(r.body).includes('username')) {
      // instance may not have usernames enabled — the profile carries the name
      r = await clerk('/users', { method: 'POST', body: JSON.stringify({ email_address: [a.email], password }) })
    }
    if (!r.ok) { console.error(`FAILED clerk create ${a.username}:`, JSON.stringify(r.body).slice(0, 300)); continue }
    user = r.body
    console.log(`✔ Clerk user created ${a.username} (${user.id})  password: ${password}`)
  } else {
    console.log(`· Clerk user exists ${a.username} (${user.id})`)
  }

  // 2) profile upsert — same shape as lib/auth createProfileForUser, then
  //    the onboarding fields the /api/profile/onboard route would set
  const { data: existing } = await db.from('profiles').select('id').eq('clerk_user_id', user.id).maybeSingle()
  if (!existing) {
    const { error } = await db.from('profiles').insert({
      clerk_user_id: user.id,
      username: a.username,
      party: a.party,
      fp_balance: 500,
      avatar_url: `/api/avatar/meme?seed=${user.id}`,
      onboarded: true,
      // gender omitted — the profiles_gender_check constraint takes NULL for
      // "no response", not the API route's 'none' literal
    })
    if (error) { console.error(`FAILED profile insert ${a.username}:`, error.message); continue }
    console.log(`✔ profile created ${a.username} (${a.party}, onboarded)`)
  } else {
    const { error } = await db.from('profiles')
      .update({ username: a.username, party: a.party, onboarded: true })
      .eq('id', existing.id)
    if (error) { console.error(`FAILED profile update ${a.username}:`, error.message); continue }
    console.log(`✔ profile updated ${a.username} (${a.party}, onboarded)`)
  }
}
console.log('DONE')

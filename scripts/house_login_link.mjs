// House-account login links (Grok 2026-08-22): the factor-two skip.
//
// The production Clerk instance requires an email verification CODE after
// password (a new-device / sign-in-verification setting that is dashboard-only
// — not exposed to the Backend API). The house mailboxes can't receive that
// code, so plain password stalls at the factor-two page. A Clerk BACKEND
// SIGN-IN TOKEN sidesteps it entirely: it completes the sign-in in ONE step
// (ticket strategy → status "complete", no OTP, no phone). Clerk's hosted
// <SignIn> auto-consumes a `__clerk_ticket` query param, so the token is just
// a URL you open.
//
// Needs the PROD secret: CLERK_LIVE_SECRET=sk_live_... node scripts/house_login_link.mjs
// (single-use, 30-day tokens — re-run whenever a bot needs a fresh session.)
import fs from 'fs'

const raw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(raw.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const SECRET = process.env.CLERK_LIVE_SECRET || env.CLERK_SECRET_KEY
const APP = env.NEXT_PUBLIC_APP_URL || 'https://politicsgo.app'
if (!SECRET.startsWith('sk_live')) {
  console.error('Need the PRODUCTION key: run with CLERK_LIVE_SECRET=sk_live_...')
  process.exit(1)
}

const HOUSE = [
  { username: 'PGODems', email: 'dems@politicsgo.net' },
  { username: 'PGOGOP', email: 'gop@politicsgo.net' },
]

for (const h of HOUSE) {
  const q = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(h.email)}`,
    { headers: { Authorization: `Bearer ${SECRET}` } }).then(r => r.json())
  const user = Array.isArray(q) && q[0]
  if (!user) { console.error(`✗ ${h.username}: no prod user`); continue }
  const tok = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST', headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user.id, expires_in_seconds: 2592000 }),
  }).then(r => r.json())
  if (!tok.token) { console.error(`✗ ${h.username}:`, JSON.stringify(tok).slice(0, 160)); continue }
  console.log(`\n${h.username} (${h.email}) — open this to sign in, no password/OTP:`)
  console.log(`${APP}/sign-in?__clerk_ticket=${tok.token}`)
}
console.log('\n(single-use · 30-day expiry · re-run for a fresh link)')

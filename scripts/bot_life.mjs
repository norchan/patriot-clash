// Gives every bot a life: a stored fighter design, a portrait avatar
// (rendered from their fighter, on a party-colored backdrop), and a couple
// of partisan posts with staggered timestamps.
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ── mirrors lib/fighter.ts (values must match its allowed sets) ─────────────
const GENDERS = ['male', 'female', 'trans']
const BODY_TYPES = ['skinny', 'average', 'athletic', 'fat']
const HAIR_STYLES = ['short', 'long', 'bun', 'afro', 'ponytail', 'bald']
const TOP_STYLES = ['tee', 'tank', 'hoodie']
const SKIN_TONES = ['#f6d7bd', '#eab88e', '#d19a6b', '#a9714b', '#7c4f33', '#53331f']
const HAIR_COLORS = ['#1c1c1c', '#4a2f1b', '#8a5a2b', '#c99e57', '#b8b8b8', '#d9488b', '#3f7ad6', '#4caf50']
const TOP_COLORS = ['#e5e7eb', '#1f2937', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899']
const PANT_COLORS = ['#1e3a5f', '#111827', '#6b7280', '#7c2d12', '#374151', '#0f766e']

function seededRand(seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return Math.abs(h) / 2147483647
}
const pick = (arr, seed) => arr[Math.floor(seededRand(seed) * arr.length) % arr.length]

const designFor = id => ({
  gender: pick(GENDERS, id + 'g'),
  body: pick(BODY_TYPES, id + 'b'),
  skin: pick(SKIN_TONES, id + 's'),
  hairStyle: pick(HAIR_STYLES, id + 'h'),
  hairColor: pick(HAIR_COLORS, id + 'hc'),
  topStyle: pick(TOP_STYLES, id + 't'),
  topColor: pick(TOP_COLORS, id + 'tc'),
  pantColor: pick(PANT_COLORS, id + 'p'),
})

// ── portrait SVG: bust on party backdrop ────────────────────────────────────
function portraitSvg(d, party) {
  const [bg1, bg2] = party === 'republican' ? ['#7f1d1d', '#dc2626'] : ['#1e3a8a', '#2563eb']
  const hair = (() => {
    switch (d.hairStyle) {
      case 'short': return `<path d="M 88 96 a 40 40 0 0 1 80 0 l 0 -14 q -40 -30 -80 0 z" fill="${d.hairColor}"/>`
      case 'long': return `<path d="M 88 96 a 40 40 0 0 1 80 0 z" fill="${d.hairColor}"/><rect x="80" y="86" width="22" height="82" rx="11" fill="${d.hairColor}"/><rect x="154" y="86" width="22" height="82" rx="11" fill="${d.hairColor}"/>`
      case 'bun': return `<path d="M 88 96 a 40 40 0 0 1 80 0 z" fill="${d.hairColor}"/><circle cx="128" cy="48" r="16" fill="${d.hairColor}"/>`
      case 'afro': return `<circle cx="128" cy="84" r="52" fill="${d.hairColor}"/>`
      case 'ponytail': return `<path d="M 88 96 a 40 40 0 0 1 80 0 z" fill="${d.hairColor}"/><path d="M 164 76 q 28 18 18 62 l -12 -4 q 8 -34 -12 -50 z" fill="${d.hairColor}"/>`
      default: return ''
    }
  })()
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/>
  </linearGradient></defs>
  <rect width="256" height="256" fill="url(#bg)"/>
  <path d="M128 18 l6 13 14 1 -10 9 3 14 -13 -7 -13 7 3 -14 -10 -9 14 -1 z" fill="rgba(255,255,255,0.25)"/>
  <ellipse cx="128" cy="238" rx="86" ry="60" fill="${d.topColor}"/>
  ${d.topStyle === 'tank' ? `<rect x="70" y="196" width="18" height="26" fill="${d.skin}"/><rect x="168" y="196" width="18" height="26" fill="${d.skin}"/>` : ''}
  ${d.topStyle === 'hoodie' ? `<path d="M 86 206 q 42 -26 84 0 l -8 16 q -34 -18 -68 0 z" fill="${d.topColor}" opacity="0.85"/>` : ''}
  <rect x="116" y="152" width="24" height="34" fill="${d.skin}"/>
  <circle cx="128" cy="116" r="42" fill="${d.skin}"/>
  ${hair}
  <circle cx="113" cy="116" r="4.5" fill="#111827"/>
  <circle cx="143" cy="116" r="4.5" fill="#111827"/>
  <rect x="104" y="102" width="18" height="4" rx="2" fill="#111827" opacity="0.7"/>
  <rect x="134" y="102" width="18" height="4" rx="2" fill="#111827" opacity="0.7"/>
  <path d="M 116 136 q 12 8 24 0" stroke="#111827" stroke-width="3.5" fill="none" stroke-linecap="round"/>
</svg>`
}

// ── partisan post pools (game-flavored trash talk) ──────────────────────────
const R_POSTS = [
  'Lower taxes, higher uppercuts. Come take my hall if you can. 🇺🇸',
  "Defended this town hall three days straight. Freedom isn't free — it's 50 FP.",
  'Small government. BIG right hook.',
  'They keep sending blue challengers. I keep sending them home.',
  'God, family, and a 4-hit combo.',
  'This hall runs on faith, coffee, and elbow grease.',
  'Come to the heartland and catch these hands. Respectfully.',
  'Left lane is for passing, left hooks are for liberals.',
  'My donation to this town hall: 1,000 FP and zero apologies.',
  'Back the blue... collar. Punch the blue... team. 🐘',
  'Read the Constitution between rounds. Builds stamina.',
  "Don't tread on me. Seriously, I'm right here on the map.",
]
const D_POSTS = [
  'Healthcare is a right. So is this left hook. 💙',
  'Organized labor? Just organized your knockout.',
  'This town hall believes in science AND street fighting.',
  'Went door-knocking. Stayed for the knockout.',
  'The blue wall stands. Try me.',
  'Diversity is our strength. My 3-hit combo is our other strength.',
  'Climate action now — the only thing burning should be your stamina bar.',
  'I canvassed this whole zone. Every hall in it is spoken for. 🫏',
  'Tax the rich, jab the red. Simple platform.',
  'Union-made fists. Look for the label.',
  'Banned books club meets at my town hall. Challengers welcome.',
  'Hope wins. Also I win. Frequently.',
]

// ── run ─────────────────────────────────────────────────────────────────────
const { data: bots } = await sb.from('profiles')
  .select('id, username, party, avatar_url')
  .like('clerk_user_id', 'bot\\_%')
console.log(`bots: ${bots.length}`)

// Which bots already have posts? (skip them on re-runs)
const withPosts = new Set()
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('profile_posts').select('profile_id').range(from, from + 999)
  if (!data?.length) break
  data.forEach(p => withPosts.add(p.profile_id))
  if (data.length < 1000) break
}

let done = 0
for (const bot of bots) {
  const design = designFor(bot.id)

  // portrait → PNG → storage
  const png = await sharp(Buffer.from(portraitSvg(design, bot.party))).png().toBuffer()
  const path = `${bot.id}.png`
  const { error: upErr } = await sb.storage.from('avatars').upload(path, png, { contentType: 'image/png', upsert: true })
  if (upErr) { console.log(`${bot.username} upload: ${upErr.message}`); continue }
  const { data: pub } = sb.storage.from('avatars').getPublicUrl(path)
  const avatarUrl = `${pub.publicUrl}?v=1`

  const { error: profErr } = await sb.from('profiles')
    .update({ avatar_url: avatarUrl, fighter: design })
    .eq('id', bot.id)
  if (profErr) { console.log(`${bot.username} profile: ${profErr.message}`); continue }

  // 2 posts, seeded, staggered over the past week
  if (!withPosts.has(bot.id)) {
    const pool = bot.party === 'republican' ? R_POSTS : D_POSTS
    const i1 = Math.floor(seededRand(bot.id + 'p1') * pool.length)
    let i2 = Math.floor(seededRand(bot.id + 'p2') * pool.length)
    if (i2 === i1) i2 = (i2 + 1) % pool.length
    const now = Date.now()
    await sb.from('profile_posts').insert([
      { profile_id: bot.id, content: pool[i1], created_at: new Date(now - seededRand(bot.id + 't1') * 6.5 * 86400e3).toISOString() },
      { profile_id: bot.id, content: pool[i2], created_at: new Date(now - seededRand(bot.id + 't2') * 2 * 86400e3).toISOString() },
    ])
  }

  done++
  if (done % 25 === 0) process.stdout.write(`\r${done}/${bots.length}`)
}
console.log(`\nbots brought to life: ${done}/${bots.length}`)

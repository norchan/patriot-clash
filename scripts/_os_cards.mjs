// Generate 4 "Money in Politics" link-card images and upload to the public
// avatars bucket (boards/opensecrets/cardN.png). Used as the hero image for
// OpenSecrets crew posts because opensecrets.org 403s datacenter og scrapes.
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('c:/Users/Micha/patriot-clash/.env.local', 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const VARIANTS = [
  { bg1: '#0b1f16', bg2: '#123527', accent: '#4ade80', tag: 'FOLLOW THE MONEY' },
  { bg1: '#101828', bg2: '#1b2a4a', accent: '#60a5fa', tag: 'CAMPAIGN CASH' },
  { bg1: '#1f1408', bg2: '#3a2510', accent: '#fbbf24', tag: 'LOBBYING WATCH' },
  { bg1: '#1a0f1f', bg2: '#321d3a', accent: '#c084fc', tag: 'DARK MONEY' },
]

function svg({ bg1, bg2, accent, tag }) {
  // rows of faint dollar-sign glyphs as texture + big wordmark
  let bills = ''
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 9; c++) {
      bills += `<text x="${40 + c * 140 + (r % 2) * 70}" y="${90 + r * 120}" font-family="Georgia, serif" font-size="64" fill="${accent}" opacity="0.07">$</text>`
    }
  }
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/>
  </linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  ${bills}
  <rect x="70" y="240" width="120" height="10" rx="5" fill="${accent}"/>
  <text x="70" y="330" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="76" fill="#ffffff">MONEY IN POLITICS</text>
  <text x="70" y="392" font-family="Arial, sans-serif" font-size="34" font-weight="bold" fill="${accent}" letter-spacing="6">${tag}</text>
  <text x="70" y="560" font-family="Arial, sans-serif" font-size="26" fill="#9ca3af">Reporting via opensecrets.org</text>
</svg>`
}

for (let i = 0; i < VARIANTS.length; i++) {
  const png = await sharp(Buffer.from(svg(VARIANTS[i]))).png().toBuffer()
  const path = `boards/opensecrets/card${i + 1}.png`
  const { error } = await supa.storage.from('avatars').upload(path, png, { contentType: 'image/png', upsert: true })
  if (error) { console.error(path, 'FAIL', error.message); process.exit(1) }
  const { data } = supa.storage.from('avatars').getPublicUrl(path)
  console.log('uploaded', data.publicUrl)
}

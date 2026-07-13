import { NextRequest, NextResponse } from 'next/server'

// Deterministic "meme card" avatar: an original funny political/patriotic (or
// animal / famous-sight) joke on a vibrant themed background, picked from the
// seed so each bot is stable and unique-ish. All jokes are our own — no real
// people, no copyrighted templates. Served as an SVG so it's free & unlimited.

const POLITICAL = [
  'Tax the Robots', 'Nap Caucus Charter Member', 'I Brought Snacks to the Debate',
  'Ask Me About Zoning', 'Certified Swing Voter', 'Yard Sign Enthusiast', 'Undecided, Proudly',
  'Filibuster Me', 'Powered by Lawn Signs', 'Will Argue for Coffee', 'My Feed Is a Warzone',
  'Term Limits for Alarm Clocks', 'Bipartisan About Pizza', 'Registered Somewhere', 'Chief of Snacks',
  'Local Politics Only', 'Ranked-Choice Everything', 'Town Hall Regular', 'Poll Worker Fan Club',
  'Caucus and Chill', 'Ballot Box Champion', 'Precinct Legend', 'Voted, Now What', 'Gerrymander This',
  'Small Government Big Snacks', 'More Parks Fewer Meetings', 'Pave the Roads Already', 'Fund the Library',
  'Recount the Snacks', 'I Read the Whole Bill (lie)', 'Debate Me Gently', 'Democracy Extra Drama',
  'Two-Party Snack System', 'Free the Interns', 'Kiss Babies Responsibly', 'Grill, Not Grind',
  'Mayor of Nothing', 'Absentee at Life', 'Committee of One',
]
const ANIMAL = [
  'Good Boy 2024', 'Certified Cat Person', 'Adopt Dont Shop', 'Squirrel Watch Captain',
  'Professional Nap Dog', 'Chaos Goblin (Cat)', 'Ferret Business Only', 'Duck Duck Vote',
  'Golden Retriever Energy', 'Beware of Cuteness',
]
const SIGHT = [
  'Wish You Were Here', 'Mountain Time', 'Beach Bum Ballot', 'Road Trip Forever',
  'Big City Small Wallet', 'National Park Enjoyer', 'Lost in a Good Way', 'Skyline Chaser',
]

const EMOJI = {
  political: ['🦅', '🇺🇸', '🗳️', '🏛️', '📢', '⭐', '🎗️', '🪧', '🐘', '🫏', '🎤', '🍕'],
  animal: ['🐶', '🐱', '🦊', '🐻', '🦁', '🐧', '🦉', '🐢', '🐕', '🐹'],
  sight: ['🗽', '🌉', '🏔️', '🏝️', '🏜️', '🎢', '🌆', '🗿'],
}
const GRADS = [
  ['#1e3a8a', '#7c3aed'], ['#7f1d1d', '#b91c1c'], ['#0f766e', '#0891b2'], ['#a21caf', '#db2777'],
  ['#b45309', '#dc2626'], ['#1d4ed8', '#0ea5e9'], ['#4d7c0f', '#16a34a'], ['#7c2d12', '#ea580c'],
  ['#312e81', '#4338ca'], ['#831843', '#9d174d'], ['#164e63', '#0e7490'], ['#3f6212', '#65a30d'],
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Math.abs(h)
}
function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// wrap into <= 3 lines of ~11 chars
function wrap(text: string): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 12 && cur) { lines.push(cur); cur = w }
    else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

export async function GET(req: NextRequest) {
  const seed = req.nextUrl.searchParams.get('seed') || 'x'
  const h = hash(seed)
  const t = h % 100
  const theme = t < 78 ? 'political' : t < 89 ? 'animal' : 'sight'
  const jokes = theme === 'political' ? POLITICAL : theme === 'animal' ? ANIMAL : SIGHT
  const joke = jokes[hash(seed + 'j') % jokes.length]
  const emoji = EMOJI[theme][hash(seed + 'e') % EMOJI[theme].length]
  const [c1, c2] = GRADS[hash(seed + 'c') % GRADS.length]
  const lines = wrap(joke)
  const startY = 172 - (lines.length - 1) * 15

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.4" r="0.7">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#000000" stop-opacity="0.25"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <rect width="256" height="256" fill="url(#v)"/>
  <text x="128" y="96" font-size="78" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  ${lines.map((l, i) => `<text x="128" y="${startY + i * 30}" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="26" fill="#ffffff" text-anchor="middle" style="paint-order:stroke;stroke:#000000;stroke-width:4px;stroke-opacity:0.55">${escapeXml(l)}</text>`).join('\n  ')}
</svg>`

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

// Generate unique, age-appropriate About Me descriptions for all 2,730 bots
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const BIOS = {
  // Teen/Early 20s (13-22)
  teen: [
    'just trying to figure things out 🤷', 'gaming and hiking enthusiast', 'coffee addict ☕',
    'probably at the gym or on a hike', 'music lover, always up for concerts', 'street food is life',
    'learning something new every day', 'outdoors > indoors', 'book nerd 📚',
    'working on personal projects', 'volunteer when i can', 'always up for road trips',
  ],
  // 20s (23-29)
  twenties: [
    'traveling whenever i can', 'gym 4x a week (sometimes 3)', 'weekend hiking trips',
    'trying new restaurants around town', 'craft beer enthusiast', 'live music fan',
    'working on side projects', 'outdoor adventures', 'photography hobby',
    'boardgame nights with friends', 'coffee shop regular', 'always planning the next trip',
    'rock climbing and camping', 'cooking new recipes on weekends', 'fitness junkie',
    'love a good farmers market', 'volunteer coordinator', 'indie film marathons',
  ],
  // 30s (30-39)
  thirties: [
    'working + fitness routine + travel goals', 'weekend trail enthusiast', 'home project person',
    'hosting dinner parties regularly', 'marathon training this year', 'love good wine',
    'weekend farmer\'s market trips', 'cooking classes sometimes', 'travel planner at heart',
    'taking woodworking seriously now', 'golf on weekends', 'mentoring younger folks',
    'budding home chef', 'road trip coordinator', 'volunteer with local nonprofits',
    'kayaking and outdoor activities', 'photography projects', 'book club member',
  ],
  // 40s (40-49)
  forties: [
    'work-life-travel balance enthusiast', 'weekend golf games', 'gardening projects',
    'love hosting cookouts', 'running half-marathons', 'hiking trails every season',
    'consulting on the side', 'home renovation enthusiast', 'mentoring in the community',
    'wine nights with friends', 'coaching kids\' sports', 'weekend travelers',
    'backyard projects in progress', 'group fitness classes', 'local events attendee',
    'working out regularly', 'travel to national parks', 'hosting dinner parties',
  ],
  // 50s (50-59)
  fifties: [
    'retired or semi-retired adventures', 'golf multiple times a week', 'travel bucket list',
    'gardening and yard work', 'grandkids when time permits', 'community volunteer',
    'weekend getaways', 'cooking for the family', 'scenic drives and hiking',
    'local community involvement', 'staying active outdoors', 'travel planning mode',
    'enjoying retirement phase', 'hosting family gatherings', 'woodworking projects',
  ],
  // 60+ (60-74)
  senior: [
    'enjoying the retired life', 'golf is my game', 'travel and adventure seeking',
    'spending time with family', 'gardening keeps me busy', 'staying active',
    'community involvement', 'traveling to see family', 'working in the yard',
    'enjoying slower pace of life', 'golf trips and tournaments', 'grandkids and family time',
    'local clubs and activities', 'hiking local trails', 'enjoying time outdoors',
  ],
}

const shuffle = a => {
  const arr = [...a]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

const pick = (a, seed) => {
  const idx = seed % a.length
  return a[idx]
}

const getBiosForAge = age => {
  if (age < 23) return BIOS.teen
  if (age < 30) return BIOS.twenties
  if (age < 40) return BIOS.thirties
  if (age < 50) return BIOS.forties
  if (age < 60) return BIOS.fifties
  return BIOS.senior
}

console.log('Generating unique bios for all bots...')

// Fetch all bots with gender, age, and current about_me (paginate to avoid limit)
let allBots = []
let from = 0
for (;;) {
  const { data } = await supa.from('profiles')
    .select('id, clerk_user_id, gender, age, about_me')
    .like('clerk_user_id', 'bot%').not('clerk_user_id', 'like', 'bot_tracker%')
    .order('clerk_user_id')
    .range(from, from + 999)
  if (!data?.length) break
  allBots = allBots.concat(data)
  if (data.length < 1000) break
  from += 1000
}
const bots = allBots

if (!bots || bots.length === 0) {
  console.log('No bots found')
  process.exit(1)
}

console.log(`Found ${bots.length} bots`)

let updated = 0, skipped = 0
const updates = []

for (const bot of bots) {
  if (bot.about_me) {
    skipped++
    continue
  }

  const age = bot.age || 30
  const bios = getBiosForAge(age)

  // Use clerk_user_id as seed for deterministic but varied selection
  const hash = bot.clerk_user_id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const bio = pick(bios, hash)

  updates.push({
    id: bot.id,
    about_me: bio,
  })
}

console.log(`Updating ${updates.length} bots (skipped ${skipped} with existing bios)`)

// Batch update in chunks of 100
for (let i = 0; i < updates.length; i += 100) {
  const chunk = updates.slice(i, i + 100)
  for (const item of chunk) {
    const { error } = await supa.from('profiles')
      .update({ about_me: item.about_me })
      .eq('id', item.id)
    if (error) {
      console.error(`Bot ${item.id} failed:`, error.message)
    } else {
      updated++
    }
  }
  console.log(`✓ Batch ${Math.floor(i / 100) + 1} done (${Math.min(i + 100, updates.length)}/${updates.length})`)
}

console.log(`DONE. Updated ${updated} bots with unique bios`)

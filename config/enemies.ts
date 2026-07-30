export type EnemyTier = 'common' | 'rare' | 'legendary'

export interface Enemy {
  id: string
  name: string
  description: string
  image: string
  party: 'republican' | 'democrat'
  tier: EnemyTier
  hp: number
  power: number
  fpReward: number
  // Relative spawn weight WITHIN its tier (default 1). The Don runs 0.35 —
  // rarest sprite in the game.
  rarity?: number
  // Minimum player level to have a real shot; below this the fight scales
  // brutally against the player (see battle page difficulty scaling)
  minLevel?: number
  moves: EnemyMove[]
  // Video clips per battle state. Missing states fall back to the idle clip,
  // and enemies with no animations at all fall back to the static image.
  animations?: {
    idle?: string
    attack?: string
    hit?: string
    faint?: string
  }
}

export interface EnemyMove {
  name: string
  damage: number
  emoji: string
}

export const republicanEnemies: Enemy[] = [
  {
    id: 'oil_baron',
    name: 'Oil Baron',
    description: 'A portly tycoon with oil rigs on his hat',
    image: '/enemies/republican/oil_baron.png',
    animations: {
      idle: '/animations/oil_baron_idle.mp4',
      attack: '/animations/oil_baron_attack.mp4',
    },
    party: 'republican',
    tier: 'rare',
    hp: 120,
    power: 80,
    fpReward: 40,
    moves: [
      { name: 'Pipeline Push', damage: 35, emoji: '🛢' },
      { name: 'Lobby Blast', damage: 50, emoji: '💰' },
      { name: 'Drill Baby Drill', damage: 65, emoji: '⛽' },
    ]
  },
  {
    id: 'cowboy',
    name: 'Lone Star',
    description: 'A tough cowboy from the heartland',
    image: '/enemies/republican/cowboy.png',
    animations: {
      idle: '/animations/cowboy_idle.mp4',
      attack: '/animations/cowboy_attack.mp4',
    },
    party: 'republican',
    tier: 'common',
    hp: 80,
    power: 60,
    fpReward: 25,
    moves: [
      { name: 'Lasso Strike', damage: 25, emoji: '🤠' },
      { name: 'Rodeo Charge', damage: 40, emoji: '🐂' },
      { name: 'Second Amendment', damage: 55, emoji: '💥' },
    ]
  },
  {
    id: 'politician',
    name: 'The Don',
    description: 'A powerful political figure in a blue suit',
    image: '/enemies/republican/politician.png',
    animations: {
      idle: '/animations/politician_idle.mp4',
      attack: '/animations/politician_attack.mp4',
    },
    party: 'republican',
    tier: 'legendary',
    hp: 240,
    power: 130,
    fpReward: 150,
    rarity: 0.35,  // rarest spawn in the game
    minLevel: 5,   // unbeatable below level 5, tough even after
    moves: [
      { name: 'Tweet Storm', damage: 50, emoji: '📱' },
      { name: 'Executive Order', damage: 75, emoji: '📋' },
      { name: 'MAGA Surge', damage: 105, emoji: '🇺🇸' },
    ]
  },
  {
    id: 'eagle',
    name: 'Freedom Eagle',
    description: 'A fierce eagle protecting its territory',
    image: '/enemies/republican/eagle.png',
    animations: {
      idle: '/animations/eagle_idle.mp4',
      attack: '/animations/eagle_attack.mp4',
    },
    party: 'republican',
    tier: 'common',
    hp: 70,
    power: 55,
    fpReward: 20,
    moves: [
      { name: 'Talon Slash', damage: 20, emoji: '🦅' },
      { name: 'Screech Attack', damage: 35, emoji: '🔊' },
      { name: 'Dive Bomb', damage: 50, emoji: '💨' },
    ]
  },
  {
    id: 'hick',
    name: 'Good Ole Boy',
    description: 'A rugged country man in overalls',
    image: '/enemies/republican/hick.png',
    animations: {
      idle: '/animations/hick_idle.mp4',
      attack: '/animations/hick_attack.mp4',
    },
    party: 'republican',
    tier: 'common',
    hp: 90,
    power: 65,
    fpReward: 28,
    moves: [
      { name: 'Pitchfork Prod', damage: 28, emoji: '🌾' },
      { name: 'Truck Rally', damage: 42, emoji: '🚛' },
      { name: 'Border Patrol', damage: 58, emoji: '🚧' },
    ]
  },
  {
    id: 'ice_agent',
    name: 'The Ice Man',
    description: 'A masked enforcer nobody can identify',
    image: '/enemies/republican/ice_agent.png',
    party: 'republican',
    tier: 'rare',
    hp: 130,
    power: 85,
    fpReward: 45,
    minLevel: 3,
    moves: [
      { name: 'Cold Cuffs', damage: 32, emoji: '🧊' },
      { name: 'Midnight Raid', damage: 50, emoji: '🚨' },
      { name: 'Deportation Van', damage: 68, emoji: '🚐' },
    ]
  },
  {
    id: 'soldier_boy',
    name: 'Sgt. Stars',
    description: 'Standing at attention, always',
    image: '/enemies/republican/soldier_boy.png',
    party: 'republican',
    tier: 'rare',
    hp: 125,
    power: 82,
    fpReward: 42,
    minLevel: 3,
    moves: [
      { name: 'Drill Command', damage: 30, emoji: '🪖' },
      { name: 'Flash Bang', damage: 48, emoji: '💥' },
      { name: 'Air Support', damage: 66, emoji: '🚁' },
    ]
  },
  {
    id: 'preppy',
    name: 'Country Club Chad',
    description: "Daddy's money and a 9-iron",
    image: '/enemies/republican/preppy.png',
    party: 'republican',
    tier: 'common',
    hp: 75,
    power: 55,
    fpReward: 22,
    moves: [
      { name: 'Golf Swing', damage: 24, emoji: '⛳' },
      { name: 'Trust Fund Flex', damage: 38, emoji: '💳' },
      { name: 'Yacht Party', damage: 50, emoji: '🛥️' },
    ]
  },
  {
    id: 'prepper',
    name: 'The Prepper',
    description: 'Been ready since \'99 — the bunker is stocked and the cans are loaded',
    image: '/enemies/republican/prepper.png',
    party: 'republican',
    tier: 'common',
    hp: 92,
    power: 60,
    fpReward: 25,
    moves: [
      { name: 'Canned Goods', damage: 25, emoji: '🥫' },
      { name: 'Bug-Out Bag', damage: 39, emoji: '🎒' },
      { name: 'Bunker Door', damage: 53, emoji: '🚪' },
    ]
  },
  {
    id: 'dan_dankas',
    name: 'Dan Dankas',
    description: 'Open-mic warrior — crowd work so brutal it counts as assault',
    image: '/enemies/republican/dan_dankas.png',
    party: 'republican',
    tier: 'rare',
    hp: 115,
    power: 74,
    fpReward: 38,
    moves: [
      { name: 'Crowd Work', damage: 30, emoji: '🗣️' },
      { name: 'Heckler Check', damage: 46, emoji: '😤' },
      { name: 'Mic Drop', damage: 60, emoji: '🎤' },
    ]
  },
  {
    id: 'megachurch_pastor',
    name: 'The Prosperity Pastor',
    description: 'The Lord blessed him with a private jet and a very persuasive collection plate',
    image: '/enemies/republican/megachurch_pastor.png',
    party: 'republican',
    tier: 'rare',
    hp: 118,
    power: 78,
    fpReward: 38,
    moves: [
      { name: 'Passing the Plate', damage: 32, emoji: '🪙' },
      { name: 'Altar Call', damage: 48, emoji: '🙌' },
      { name: 'Seed Offering', damage: 62, emoji: '✨' },
    ]
  },
  {
    id: 'crypto_bro',
    name: 'The Crypto Bro',
    description: 'Down 90% but still telling you to have fun staying poor',
    image: '/enemies/republican/crypto_bro.png',
    party: 'republican',
    tier: 'common',
    hp: 78,
    power: 56,
    fpReward: 23,
    moves: [
      { name: 'Diamond Hands', damage: 24, emoji: '💎' },
      { name: 'Rug Pull', damage: 37, emoji: '🪤' },
      { name: 'To The Moon', damage: 51, emoji: '🌕' },
    ]
  },
  {
    id: 'sheriff',
    name: 'The Sheriff',
    description: 'Been the law around here for thirty years and the buckle proves it',
    image: '/enemies/republican/sheriff.png',
    party: 'republican',
    tier: 'common',
    hp: 95,
    power: 64,
    fpReward: 27,
    moves: [
      { name: 'Buckle Bash', damage: 26, emoji: '🤠' },
      { name: 'Aviator Glare', damage: 40, emoji: '🕶️' },
      { name: 'Long Arm of the Law', damage: 54, emoji: '⭐' },
    ]
  },
  {
    id: 'influencer',
    name: 'Kirk El Captain',
    description: 'Campus-debate champion — the jaw arrives before the facts do',
    image: '/enemies/republican/influencer.png',
    party: 'republican',
    tier: 'common',
    hp: 85,
    power: 62,
    fpReward: 26,
    moves: [
      { name: 'Debate Me', damage: 26, emoji: '🎤' },
      { name: 'Gotcha Clip', damage: 40, emoji: '📹' },
      { name: 'Viral Rant', damage: 55, emoji: '📱' },
    ]
  },
  {
    id: 'billionaire',
    name: 'Rocket Man',
    description: 'The richest man alive, allegedly',
    image: '/enemies/republican/billionaire.png',
    party: 'republican',
    tier: 'legendary',
    hp: 170,
    power: 105,
    fpReward: 70,
    minLevel: 4,
    moves: [
      { name: 'Hostile Takeover', damage: 42, emoji: '💼' },
      { name: 'Stock Crash', damage: 60, emoji: '📉' },
      { name: 'Rocket Test', damage: 90, emoji: '🚀' },
    ]
  },
]

export const democratEnemies: Enemy[] = [
  {
    id: 'maine',
    name: 'The Mainer',
    description: 'Unbothered, unmoved, unimpressed — the wicked stare of the North',
    image: '/enemies/democrat/maine.png',
    party: 'democrat',
    tier: 'rare',
    hp: 115,
    power: 74,
    fpReward: 38,
    moves: [
      { name: 'Cold Stare', damage: 30, emoji: '🥶' },
      { name: 'Wicked Slap', damage: 46, emoji: '🖐️' },
      { name: 'Lobster Toss', damage: 60, emoji: '🦞' },
    ]
  },
  {
    id: 'firebrand',
    name: 'Firebrand',
    description: 'The movement in heels — every sentence is a rally',
    image: '/enemies/democrat/firebrand.png',
    party: 'democrat',
    tier: 'rare',
    hp: 118,
    power: 76,
    fpReward: 39,
    moves: [
      { name: 'Grassroots Jab', damage: 30, emoji: '🌱' },
      { name: 'Clapback', damage: 46, emoji: '👏' },
      { name: 'Green New Haymaker', damage: 60, emoji: '💚' },
    ]
  },
  {
    id: 'social_bean',
    name: 'Social Bean',
    description: 'Powered entirely by cold brew and group chats',
    image: '/enemies/democrat/social_bean.png',
    party: 'democrat',
    tier: 'common',
    hp: 95,
    power: 62,
    fpReward: 26,
    moves: [
      { name: 'Hot Take', damage: 26, emoji: '🔥' },
      { name: 'Cold Brew Splash', damage: 40, emoji: '🧋' },
      { name: 'Ratio’d', damage: 52, emoji: '📉' },
    ]
  },
  {
    id: 'tampon_tim',
    name: 'The Governor',
    description: 'The folksy governor — paces the stage and never stops pointing',
    image: '/enemies/democrat/tampon_tim.png',
    party: 'democrat',
    tier: 'rare',
    hp: 120,
    power: 78,
    fpReward: 40,
    moves: [
      { name: 'Folksy Charm', damage: 30, emoji: '😄' },
      { name: 'Double Point', damage: 46, emoji: '👉' },
      { name: 'Tampon Toss', damage: 60, emoji: '🧻' },
    ]
  },
  {
    id: 'crazy_liberal',
    name: 'HR',
    description: 'The department of fun prevention — every fight is a compliance review',
    image: '/enemies/democrat/crazy_liberal.png',
    party: 'democrat',
    tier: 'common',
    hp: 75,
    power: 58,
    fpReward: 22,
    moves: [
      { name: 'Write-Up', damage: 22, emoji: '📝' },
      { name: 'Mandatory Training', damage: 38, emoji: '📋' },
      { name: 'Termination', damage: 52, emoji: '💼' },
    ]
  },
  {
    id: 'crying_liberal',
    name: 'Tear Drop',
    description: 'An emotional protester in a green jacket',
    image: '/enemies/democrat/crying_liberal.png',
    animations: {
      idle: '/animations/crying_liberal_idle.mp4',
      attack: '/animations/crying_liberal_attack.mp4',
    },
    party: 'democrat',
    tier: 'common',
    hp: 65,
    power: 50,
    fpReward: 18,
    moves: [
      { name: 'Guilt Trip', damage: 18, emoji: '😢' },
      { name: 'Protest March', damage: 32, emoji: '✌' },
      { name: 'Social Media Storm', damage: 48, emoji: '📲' },
    ]
  },
  {
    id: 'dem_politician',
    name: 'Shadow Senator',
    description: 'A powerful political operative',
    image: '/enemies/democrat/politician_dems.png',
    animations: {
      idle: '/animations/politician_dems_idle.mp4',
      attack: '/animations/politician_dems_attack.mp4',
    },
    party: 'democrat',
    tier: 'legendary',
    hp: 180,
    power: 110,
    fpReward: 75,
    moves: [
      { name: 'Filibuster', damage: 40, emoji: '🎤' },
      { name: 'Tax Hike', damage: 65, emoji: '💸' },
      { name: 'Deep State', damage: 95, emoji: '🕵' },
    ]
  },
  {
    id: 'purple_hair',
    name: 'Purple Fury',
    description: 'A fierce activist with purple hair',
    image: '/enemies/democrat/purple_hair.png',
    animations: {
      idle: '/animations/purple_fury_idle.mp4',
      attack: '/animations/purple_hair_attack.mp4',
    },
    party: 'democrat',
    tier: 'rare',
    hp: 110,
    power: 75,
    fpReward: 35,
    moves: [
      { name: 'Virtue Signal', damage: 30, emoji: '💜' },
      { name: 'Safe Space Slam', damage: 48, emoji: '🏳' },
      { name: 'Identity Politics', damage: 62, emoji: '🌈' },
    ]
  },
  {
    id: 'protestor',
    name: 'Antifa Kid',
    description: 'Hood up, bandana on, opinions non-negotiable',
    image: '/enemies/democrat/protestor.png',
    party: 'democrat',
    tier: 'rare',
    hp: 130,
    power: 85,
    fpReward: 42,
    moves: [
      { name: 'Spray Tag', damage: 32, emoji: '🎨' },
      { name: 'Soup Toss', damage: 50, emoji: '🥫' },
      { name: 'Dumpster Slam', damage: 70, emoji: '🗑️' },
    ]
  },
  {
    id: 'yard_sign_lady',
    name: 'The Yard Sign Lady',
    description: 'In this house we believe — and the sign doubles as a shield',
    image: '/enemies/democrat/yard_sign_lady.png',
    party: 'democrat',
    tier: 'common',
    hp: 88,
    power: 58,
    fpReward: 24,
    moves: [
      { name: 'Sign Slam', damage: 24, emoji: '🪧' },
      { name: 'HOA Complaint', damage: 38, emoji: '📋' },
      { name: 'Neighborhood Watch', damage: 52, emoji: '👀' },
    ]
  },
  {
    id: 'union_barista',
    name: 'The Union Barista',
    description: 'Your oat milk latte comes with a pamphlet and a shift you can sign up for',
    image: '/enemies/democrat/union_barista.png',
    party: 'democrat',
    tier: 'common',
    hp: 82,
    power: 57,
    fpReward: 24,
    moves: [
      { name: 'Scalding Pour', damage: 25, emoji: '☕' },
      { name: 'Pamphlet Drop', damage: 38, emoji: '📰' },
      { name: 'Walkout', damage: 52, emoji: '✊' },
    ]
  },
  {
    id: 'adjunct_professor',
    name: 'The Adjunct',
    description: 'Four classes, three campuses, one health plan he cannot afford',
    image: '/enemies/democrat/adjunct_professor.png',
    party: 'democrat',
    tier: 'common',
    hp: 76,
    power: 54,
    fpReward: 22,
    moves: [
      { name: 'Pop Quiz', damage: 23, emoji: '📝' },
      { name: 'Cite Your Source', damage: 36, emoji: '📚' },
      { name: 'Failing Grade', damage: 50, emoji: '🅵' },
    ]
  },
  {
    id: 'climate_kid',
    name: 'The Climate Kid',
    description: 'Skipped fourth period to explain exactly how you ruined everything',
    image: '/enemies/democrat/climate_kid.png',
    party: 'democrat',
    tier: 'rare',
    hp: 112,
    power: 76,
    fpReward: 36,
    moves: [
      { name: 'Placard Swing', damage: 31, emoji: '🪧' },
      { name: 'How Dare You', damage: 47, emoji: '😤' },
      { name: 'School Strike', damage: 61, emoji: '🌍' },
    ]
  },
  {
    id: 'anchor',
    name: 'Prime Time',
    description: 'Reporting live, with an agenda',
    image: '/enemies/democrat/anchor.png',
    party: 'democrat',
    tier: 'common',
    hp: 80,
    power: 60,
    fpReward: 24,
    moves: [
      { name: 'Breaking News', damage: 25, emoji: '📺' },
      { name: 'Hot Take', damage: 40, emoji: '🎙️' },
      { name: 'Fact Check', damage: 54, emoji: '✅' },
    ]
  },
  {
    id: 'palestine',
    name: 'The Activist',
    description: 'A voice for the cause, keffiyeh and all',
    image: '/enemies/democrat/palestine.png',
    party: 'democrat',
    tier: 'common',
    hp: 78,
    power: 58,
    fpReward: 23,
    moves: [
      { name: 'Chant Wave', damage: 24, emoji: '📣' },
      { name: 'Sit-In', damage: 38, emoji: '🪧' },
      { name: 'Encampment', damage: 52, emoji: '⛺' },
    ]
  },
  {
    id: 'comrade',
    name: 'The Comrade',
    description: 'Seize the means, one hat at a time',
    image: '/enemies/democrat/comrade.png',
    party: 'democrat',
    tier: 'common',
    hp: 88,
    power: 63,
    fpReward: 27,
    moves: [
      { name: 'Redistribute', damage: 26, emoji: '☭' },
      { name: 'Union Strike', damage: 42, emoji: '🚩' },
      { name: 'Five-Year Plan', damage: 56, emoji: '🏭' },
    ]
  },
  {
    id: 'drag',
    name: 'The Diva',
    description: 'Sashaying into the culture war — the beard is the statement',
    image: '/enemies/democrat/drag.png',
    party: 'democrat',
    tier: 'rare',
    hp: 120,
    power: 80,
    fpReward: 40,
    minLevel: 3,
    moves: [
      { name: 'Lip Sync', damage: 30, emoji: '💄' },
      { name: 'Death Drop', damage: 48, emoji: '💅' },
      { name: 'Story Hour', damage: 66, emoji: '📖' },
    ]
  },
  {
    id: 'senator',
    name: 'The Chairman',
    description: 'Decades of seniority and dark money',
    image: '/enemies/democrat/senator.png',
    party: 'democrat',
    tier: 'legendary',
    hp: 175,
    power: 108,
    fpReward: 72,
    minLevel: 4,
    moves: [
      { name: 'Tampon Toss', damage: 44, emoji: '💊' },
      { name: 'Committee Hearing', damage: 62, emoji: '⚖️' },
      { name: 'Omnibus Bill', damage: 92, emoji: '📚' },
    ]
  },
]

// Returns enemies BELONGING TO the given party — callers compute the
// opponent party themselves and pass it in. (This used to take the player's
// party and invert internally; combined with callers that also inverted, it
// double-inverted and showed everyone their own party's enemies.)
export function getEnemiesForParty(party: 'democrat' | 'republican'): Enemy[] {
  return party === 'democrat' ? democratEnemies : republicanEnemies
}

export function getRandomEnemy(party: 'democrat' | 'republican'): Enemy {
  const enemies = getEnemiesForParty(party)
  const rand = Math.random()
  let pool: Enemy[]
  if (rand < 0.10) {
    pool = enemies.filter(e => e.tier === 'legendary')
  } else if (rand < 0.40) {
    pool = enemies.filter(e => e.tier === 'rare')
  } else {
    pool = enemies.filter(e => e.tier === 'common')
  }
  if (pool.length === 0) pool = enemies
  // rarity-weighted pick within the tier (The Don at 0.35 is the rarest)
  const total = pool.reduce((s, e) => s + (e.rarity ?? 1), 0)
  let r = Math.random() * total
  for (const e of pool) {
    r -= e.rarity ?? 1
    if (r <= 0) return e
  }
  return pool[pool.length - 1]
}

export function getEnemyById(id: string): Enemy | undefined {
  return [...republicanEnemies, ...democratEnemies].find(e => e.id === id)
}
// ── Enemies with a 3D battle rig ────────────────────────────────────────────
// The battle stage is 3D-only: Enemy3D loads `<id>_idle.glb` + `<id>_throw.glb`
// and a missing pair 404s and takes the whole battle screen down with it
// (Michael hit exactly that on union_barista, 2026-07-29). Anyone NOT listed
// here is swapped at fight start for a 3D-capable enemy of the same tier.
//
// This list is hand-maintained and WILL drift as characters are added ahead of
// their Meshy runs — that drift is what broke it. `tests/economy.test.ts`
// checks every id here against the files actually in public/models, so the
// next time they disagree a test fails instead of a player's battle.
export const ENEMY_3D_IDS = [
  'comrade', 'oil_baron', 'cowboy', 'politician', 'hick', 'ice_agent', 'soldier_boy', 'preppy',
  'influencer', 'billionaire', 'crazy_liberal', 'crying_liberal', 'dem_politician', 'purple_hair',
  'protestor', 'anchor', 'palestine', 'drag', 'senator', 'tampon_tim', 'dan_dankas', 'maine',
  'firebrand', 'social_bean', 'prepper', 'yard_sign_lady',
  // NOT here (art exists, no rig yet — 2D-sprite roster only, they get swapped
  // at fight start): megachurch_pastor, crypto_bro, sheriff, union_barista,
  // adjunct_professor, climate_kid. Add each one back the moment its
  // _idle/_throw pair lands in public/models.
] as const

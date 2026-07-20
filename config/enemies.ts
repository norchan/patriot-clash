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
    id: 'influencer',
    name: 'Campus Crusader',
    description: 'Armed with a microphone and a pocket Constitution',
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
    name: 'Policy Wonk',
    description: 'An intense activist with strong opinions',
    image: '/enemies/democrat/crazy_liberal.png',
    animations: {
      idle: '/animations/crazy_liberal_idle.mp4',
      attack: '/animations/crazy_liberal_attack.mp4',
    },
    party: 'democrat',
    tier: 'common',
    hp: 75,
    power: 58,
    fpReward: 22,
    moves: [
      { name: 'Regulation Rush', damage: 22, emoji: '📜' },
      { name: 'Cancel Strike', damage: 38, emoji: '🚫' },
      { name: 'Woke Wave', damage: 52, emoji: '✊' },
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
    name: 'Riot Gear',
    description: 'A fully equipped protest enforcer',
    image: '/enemies/democrat/protestor.png',
    animations: {
      idle: '/animations/protestor_idle.mp4',
      attack: '/animations/protestor_attack.mp4',
    },
    party: 'democrat',
    tier: 'rare',
    hp: 130,
    power: 85,
    fpReward: 42,
    moves: [
      { name: 'Megaphone Blast', damage: 32, emoji: '📢' },
      { name: 'Shield Bash', damage: 50, emoji: '🛡' },
      { name: 'Full Mobilize', damage: 70, emoji: '🗡' },
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
    description: 'Sashaying into the culture war',
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
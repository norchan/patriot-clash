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
  moves: EnemyMove[]
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
    image: '/enemies/republican/oil_baron.jpg',
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
    image: '/enemies/republican/cowboy.jpg',
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
    image: '/enemies/republican/politician.jpg',
    party: 'republican',
    tier: 'legendary',
    hp: 200,
    power: 120,
    fpReward: 80,
    moves: [
      { name: 'Tweet Storm', damage: 45, emoji: '📱' },
      { name: 'Executive Order', damage: 70, emoji: '📋' },
      { name: 'MAGA Surge', damage: 100, emoji: '🇺🇸' },
    ]
  },
  {
    id: 'eagle',
    name: 'Freedom Eagle',
    description: 'A fierce eagle protecting its territory',
    image: '/enemies/republican/eagle.jpg',
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
    image: '/enemies/republican/hick.jpg',
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
]

export const democratEnemies: Enemy[] = [
  {
    id: 'crazy_liberal',
    name: 'Policy Wonk',
    description: 'An intense activist with strong opinions',
    image: '/enemies/democrat/crazy_liberal.jpg',
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
    image: '/enemies/democrat/crying_liberal.jpg',
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
    image: '/enemies/democrat/politician_dems.jpg',
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
    image: '/enemies/democrat/purple_hair.jpg',
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
    image: '/enemies/democrat/protestor.jpg',
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
]

export function getEnemiesForParty(party: 'democrat' | 'republican'): Enemy[] {
  return party === 'democrat' ? republicanEnemies : democratEnemies
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
  return pool[Math.floor(Math.random() * pool.length)]
}

export function getEnemyById(id: string): Enemy | undefined {
  return [...republicanEnemies, ...democratEnemies].find(e => e.id === id)
}
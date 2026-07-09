// Fighter designs (player-created street fighters) + level/stat scaling.
// Designs are stored in profiles.fighter (JSONB); anyone without a saved
// design gets a deterministic default derived from their profile id.

export type Gender = 'male' | 'female' | 'trans'
export type BodyType = 'skinny' | 'average' | 'athletic' | 'fat'
export type HairStyle = 'short' | 'long' | 'bun' | 'afro' | 'ponytail' | 'bald'
export type TopStyle = 'tee' | 'tank' | 'hoodie'
export type FacialHair = 'none' | 'mustache' | 'beard' | 'goatee'
export type Eyewear = 'none' | 'glasses' | 'shades'
export type Hat = 'none' | 'cap' | 'beanie' | 'cowboy'

export interface FighterDesign {
  gender: Gender
  body: BodyType
  skin: string
  hairStyle: HairStyle
  hairColor: string
  topStyle: TopStyle
  topColor: string
  pantColor: string
  facialHair: FacialHair
  eyewear: Eyewear
  hat: Hat
}

export const GENDERS: Gender[] = ['male', 'female', 'trans']
export const BODY_TYPES: BodyType[] = ['skinny', 'average', 'athletic', 'fat']
export const HAIR_STYLES: HairStyle[] = ['short', 'long', 'bun', 'afro', 'ponytail', 'bald']
export const TOP_STYLES: TopStyle[] = ['tee', 'tank', 'hoodie']
export const FACIAL_HAIRS: FacialHair[] = ['none', 'mustache', 'beard', 'goatee']
export const EYEWEARS: Eyewear[] = ['none', 'glasses', 'shades']
export const HATS: Hat[] = ['none', 'cap', 'beanie', 'cowboy']

export const SKIN_TONES = ['#f6d7bd', '#eab88e', '#d19a6b', '#a9714b', '#7c4f33', '#53331f']
export const HAIR_COLORS = ['#1c1c1c', '#4a2f1b', '#8a5a2b', '#c99e57', '#b8b8b8', '#d9488b', '#3f7ad6', '#4caf50']
export const TOP_COLORS = ['#e5e7eb', '#1f2937', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899']
export const PANT_COLORS = ['#1e3a5f', '#111827', '#6b7280', '#7c2d12', '#374151', '#0f766e']

function seededRand(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return Math.abs(h) / 2147483647
}
const pick = <T,>(arr: T[], seed: string): T => arr[Math.floor(seededRand(seed) * arr.length) % arr.length]

export function defaultFighter(seed: string): FighterDesign {
  return {
    gender: pick(GENDERS, seed + 'g'),
    body: pick(BODY_TYPES, seed + 'b'),
    skin: pick(SKIN_TONES, seed + 's'),
    hairStyle: pick(HAIR_STYLES, seed + 'h'),
    hairColor: pick(HAIR_COLORS, seed + 'hc'),
    topStyle: pick(TOP_STYLES, seed + 't'),
    topColor: pick(TOP_COLORS, seed + 'tc'),
    pantColor: pick(PANT_COLORS, seed + 'p'),
    // Accessories lean heavily toward 'none' so most generated fighters
    // stay clean-cut and the ones with a hat or beard stand out
    facialHair: pick(['none', 'none', 'none', 'mustache', 'beard', 'goatee'] as FacialHair[], seed + 'fh'),
    eyewear: pick(['none', 'none', 'none', 'none', 'glasses', 'shades'] as Eyewear[], seed + 'ew'),
    hat: pick(['none', 'none', 'none', 'none', 'cap', 'beanie', 'cowboy'] as Hat[], seed + 'ht'),
  }
}

// Coerce arbitrary stored JSON into a valid design (fills gaps with defaults)
export function sanitizeFighter(raw: any, seed: string): FighterDesign {
  const d = defaultFighter(seed)
  if (!raw || typeof raw !== 'object') return d
  return {
    gender: GENDERS.includes(raw.gender) ? raw.gender : d.gender,
    body: BODY_TYPES.includes(raw.body) ? raw.body : d.body,
    skin: SKIN_TONES.includes(raw.skin) ? raw.skin : d.skin,
    hairStyle: HAIR_STYLES.includes(raw.hairStyle) ? raw.hairStyle : d.hairStyle,
    hairColor: HAIR_COLORS.includes(raw.hairColor) ? raw.hairColor : d.hairColor,
    topStyle: TOP_STYLES.includes(raw.topStyle) ? raw.topStyle : d.topStyle,
    topColor: TOP_COLORS.includes(raw.topColor) ? raw.topColor : d.topColor,
    pantColor: PANT_COLORS.includes(raw.pantColor) ? raw.pantColor : d.pantColor,
    // Designs saved before accessories existed default to bare — a player's
    // fighter must never grow a surprise beard on upgrade
    facialHair: FACIAL_HAIRS.includes(raw.facialHair) ? raw.facialHair : 'none',
    eyewear: EYEWEARS.includes(raw.eyewear) ? raw.eyewear : 'none',
    hat: HATS.includes(raw.hat) ? raw.hat : 'none',
  }
}

// ── Level & stats ───────────────────────────────────────────────────────────
// Level comes from battles won: fast early levels, slowing later. Strength
// raises damage, stamina raises attack frequency, and combo length unlocks
// at levels 3 / 7 / 12.
export function fighterLevel(wins: number): number {
  return Math.min(30, 1 + Math.floor(Math.sqrt(Math.max(0, wins) * 1.5)))
}

export interface FighterStats {
  level: number
  strength: number    // damage multiplier basis
  stamina: number     // attack tempo (attacks per fight budget)
  blockChance: number
  dodgeChance: number
  comboMax: 1 | 2 | 3 | 4
}

export function fighterStats(level: number): FighterStats {
  return {
    level,
    strength: 8 + level * 0.7,
    stamina: 9 + Math.floor(level / 2),
    blockChance: Math.min(0.35, 0.12 + level * 0.008),
    dodgeChance: Math.min(0.22, 0.07 + level * 0.005),
    comboMax: level >= 12 ? 4 : level >= 7 ? 3 : level >= 3 ? 2 : 1,
  }
}

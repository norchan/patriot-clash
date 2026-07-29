// PLAYABLE FIGHTER CATALOG — the single source of truth for both the picker
// UI and the server-side validation in /api/profile/settings. Lives in config/
// (not the 3D component) so API routes can import it without dragging three.js
// into a serverless bundle.
//
// SPRITE FIGHTERS (Michael 2026-07-27): roster characters promoted to playable
// fighters. They keep their own head (no bobblehead swap) and are locked to
// their own party — a Democrat can never fight as The Don.

export interface FighterMeta {
  id: string
  label: string
  img: string
  demOnly?: boolean
  party?: 'democrat' | 'republican'  // hard party lock
  ownHead?: boolean                  // sprite fighter — never head-swapped
  minLevel?: number                  // level unlock gate (omit = always open)
  thumb?: string                     // picker art override
  /** Arena height in world units. Generic bodies sit at 2.2. Sprite fighters
   *  vary — squat, wide characters crowd the 1.1 rest gap at full height, but
   *  trimming everyone made them look stunted (Michael 2026-07-28). Tune per
   *  character rather than with one blanket number. */
  fitHeight?: number
}

export const FIGHTERS: FighterMeta[] = [
  { id: 'fighter1', label: 'Alex', img: '/fighters/fighter1.png' },
  { id: 'fighter2', label: 'Maya', img: '/fighters/fighter2.png' },
  { id: 'fighter3', label: 'Marcus', img: '/fighters/fighter3.png' },
  { id: 'fighter4', label: 'Nina', img: '/fighters/fighter4.png' },
  { id: 'fighter5', label: 'Rainbow', img: '/fighters/fighter5.png' },
  { id: 'fighter6', label: 'Deon', img: '/fighters/fighter6.png' },
  // ── SPRITE FIGHTERS ──
  // Roster characters with the full six-clip fighter set. minLevel is OFF on
  // all of them (Michael 2026-07-27) for playtesting — add `minLevel: N` per
  // entry to re-arm unlock gates. Model files: <id>_<rep|dem>_<clip>.glb
  // ── republican ──
  { id: 'cowboy', label: 'Lone Star', img: '/enemies/republican/cowboy.png',
    thumb: '/enemies/republican/cowboy.png', party: 'republican', ownHead: true, minLevel: 3 },
  { id: 'oil_baron', label: 'Oil Baron', img: '/enemies/republican/oil_baron.png',
    thumb: '/enemies/republican/oil_baron.png', party: 'republican', ownHead: true, minLevel: 5 },
  { id: 'prepper', label: 'The Prepper', img: '/enemies/republican/prepper.png',
    thumb: '/enemies/republican/prepper.png', party: 'republican', ownHead: true, minLevel: 5 },
  { id: 'ice_agent', label: 'The Ice Man', img: '/enemies/republican/ice_agent.png',
    thumb: '/enemies/republican/ice_agent.png', party: 'republican', ownHead: true, minLevel: 8 },
  // The Don's head+hair eat most of the height budget, so fitting him to the
  // standard 2.2 left his BODY looking stunted next to everyone else — give him
  // a taller overall fit so he reads full-size (Michael 2026-07-28).
  { id: 'don', label: 'The Don', img: '/enemies/republican/politician.png',
    thumb: '/enemies/republican/politician.png', party: 'republican', ownHead: true, minLevel: 10,
    fitHeight: 2.6 },
  { id: 'billionaire', label: 'Rocket Man', img: '/enemies/republican/billionaire.png',
    thumb: '/enemies/republican/billionaire.png', party: 'republican', ownHead: true, minLevel: 12 },
  // ── democrat ──
  { id: 'protestor', label: 'Antifa Kid', img: '/enemies/democrat/protestor.png',
    thumb: '/enemies/democrat/protestor.png', party: 'democrat', ownHead: true, minLevel: 3 },
  { id: 'purple_hair', label: 'Purple Fury', img: '/enemies/democrat/purple_hair.png',
    thumb: '/enemies/democrat/purple_hair.png', party: 'democrat', ownHead: true, minLevel: 5 },
  { id: 'comrade', label: 'The Comrade', img: '/enemies/democrat/comrade.png',
    thumb: '/enemies/democrat/comrade.png', party: 'democrat', ownHead: true, minLevel: 5 },
  { id: 'crazy_liberal', label: 'HR', img: '/enemies/democrat/crazy_liberal.png',
    thumb: '/enemies/democrat/crazy_liberal.png', party: 'democrat', ownHead: true, minLevel: 8 },
  { id: 'teardrop', label: 'Tear Drop', img: '/enemies/democrat/crying_liberal.png',
    thumb: '/enemies/democrat/crying_liberal.png', party: 'democrat', ownHead: true, minLevel: 10 },
  { id: 'climate_kid', label: 'The Climate Kid', img: '/enemies/democrat/climate_kid.png',
    thumb: '/enemies/democrat/climate_kid.png', party: 'democrat', ownHead: true, minLevel: 12 },
]

export const fighterMeta = (id: string): FighterMeta | undefined =>
  FIGHTERS.find(f => f.id === id)

/** Valid to pick at all? */
export const isValidFighter = (id: unknown): id is string =>
  typeof id === 'string' && FIGHTERS.some(f => f.id === id)

/** Valid for THIS party? (party-locked sprite fighters) */
export function fighterAllowedForParty(id: string, party: string | null | undefined): boolean {
  const f = fighterMeta(id)
  if (!f) return false
  if (f.party && f.party !== party) return false
  if (f.demOnly && party !== 'democrat') return false
  return true
}

/** Has this player earned the fighter? Bobblehead bodies have no gate. */
export function fighterUnlockedAtLevel(id: string, level: number): boolean {
  const f = fighterMeta(id)
  if (!f) return false
  return level >= (f.minLevel ?? 1)
}

/** Wins needed to reach a level — inverse of fighterLevel() in lib/fighter.ts.
 *  Used for "unlocks at level N" copy so the numbers can never drift. */
export const winsForLevel = (lvl: number) => Math.ceil(((lvl - 1) ** 2) / 1.5)

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
}

export const FIGHTERS: FighterMeta[] = [
  { id: 'fighter1', label: 'Alex', img: '/fighters/fighter1.png' },
  { id: 'fighter2', label: 'Maya', img: '/fighters/fighter2.png' },
  { id: 'fighter3', label: 'Marcus', img: '/fighters/fighter3.png' },
  { id: 'fighter4', label: 'Nina', img: '/fighters/fighter4.png' },
  { id: 'fighter5', label: 'Rainbow', img: '/fighters/fighter5.png' },
  { id: 'fighter6', label: 'Deon', img: '/fighters/fighter6.png' },
  // ── sprite fighters ──
  // minLevel temporarily OFF (Michael 2026-07-27) so they can be playtested.
  // Put `minLevel: 10` back on both to re-arm the level-10 unlock gate.
  { id: 'don', label: 'The Don', img: '/enemies/republican/politician.png',
    thumb: '/enemies/republican/politician.png', party: 'republican', ownHead: true },
  { id: 'teardrop', label: 'Tear Drop', img: '/enemies/democrat/crying_liberal.png',
    thumb: '/enemies/democrat/crying_liberal.png', party: 'democrat', ownHead: true },
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

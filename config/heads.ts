// ── Fighter HEAD catalog ─────────────────────────────────────────────────────
// Every head works on every body. Adding a new head is catalog-only:
//   1. Drop a transparent-background cutout at public/heads/<id>.png
//      (rendered from a 3D model via scripts/render_heads.mjs, or any
//      transparent PNG facing forward).
//   2. Add a row here. Done — the designer grid and PvP pick it up.
// `party` is an optional future gate (unused today: full mix per design).

export interface HeadMeta {
  id: string
  label: string
  party?: 'democrat' | 'republican'
  /** per-head size multiplier on the in-fight billboard (default 1) */
  scale?: number
  /** per-head vertical offset in world units (default 0; + is up) */
  dy?: number
}

export const headMeta = (id: string) => HEADS.find(h => h.id === id)

export const HEADS: HeadMeta[] = [
  // Republican-flavored
  { id: 'politician', label: 'The Don', party: 'republican' },
  { id: 'cowboy', label: 'Lone Star', party: 'republican' },
  { id: 'hick', label: 'Good Ole Boy', party: 'republican' },
  { id: 'ice_agent', label: 'The Ice Man', party: 'republican' },
  { id: 'soldier_boy', label: 'Sgt. Stars', party: 'republican' },
  { id: 'preppy', label: 'Chad', party: 'republican' },
  { id: 'influencer', label: 'Crusader', party: 'republican' },
  { id: 'oil_baron', label: 'Oil Baron', party: 'republican' },
  { id: 'billionaire', label: 'Rocket Man', party: 'republican' },
  // Democrat-flavored
  { id: 'comrade', label: 'The Comrade', party: 'democrat' },
  { id: 'crazy_liberal', label: 'True Believer', party: 'democrat' },
  { id: 'crying_liberal', label: 'Snowflake', party: 'democrat' },
  { id: 'dem_politician', label: 'The Speaker', party: 'democrat' },
  { id: 'purple_hair', label: 'Purple Reign', party: 'democrat' },
  { id: 'protestor', label: 'Protestor', party: 'democrat' },
  { id: 'anchor', label: 'The Anchor', party: 'democrat' },
  { id: 'palestine', label: 'Activist', party: 'democrat' },
  { id: 'drag', label: 'The Queen', party: 'democrat' },
  { id: 'senator', label: 'The Senator', party: 'democrat' },
]

// v8 = adaptive jaw clip (zero clothing on every head), normalized head
// heights (uniform bobble scale), senator nose fix
export const headImage = (id: string) => `/heads/${id}.png?v=8`
// side-profile render of the same head — used IN FIGHTS so the face looks at
// the opponent (the frontal art stays in the designer grid)
export const headSideImage = (id: string) => `/heads/${id}_side.png?v=8`
export const isValidHead = (id: unknown): id is string =>
  typeof id === 'string' && HEADS.some(h => h.id === id)

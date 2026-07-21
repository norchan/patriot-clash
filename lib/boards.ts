import 'server-only'

// P/ BOARD (psub) resolution + feeds. Boards come in two flavors:
//  - virtual: p/all and p/democrats|republicans are windows over every post
//  - real rows in `boards`: topic (videos, space...), sports (team subs),
//    state (also aggregates that state's hall posts), local (one per town
//    hall — the hall's town square seen as a psub), user (player-created)

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'Washington D.C.', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
const NAME_TO_CODE = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase().replace(/[^a-z]/g, ''), code]))

export interface BoardRow {
  id: string; slug: string; name: string
  category: 'topic' | 'sports' | 'state' | 'local' | 'user'
  subcategory: string | null; gym_id: string | null; state: string | null
}

export type ResolvedBoard =
  | { kind: 'all'; label: string }
  | { kind: 'party'; key: 'democrat' | 'republican'; label: string }
  | { kind: 'board'; board: BoardRow; label: string }

export function slugifyBoard(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

export async function resolvePBoard(admin: any, raw: string): Promise<ResolvedBoard | null> {
  const b = decodeURIComponent(raw).toLowerCase()
  const compact = b.replace(/[^a-z]/g, '')
  if (compact === 'all') return { kind: 'all', label: 'p/all' }
  if (['democrats', 'democrat', 'dems'].includes(compact)) return { kind: 'party', key: 'democrat', label: 'p/democrats' }
  if (['republicans', 'republican', 'reps'].includes(compact)) return { kind: 'party', key: 'republican', label: 'p/republicans' }

  // two-letter state codes → that state's board
  const code = compact.length === 2 ? compact.toUpperCase() : NAME_TO_CODE[compact]
  const slug = code && STATE_NAMES[code]
    ? STATE_NAMES[code].toLowerCase().replace(/[^a-z]/g, '')
    : slugifyBoard(b)
  if (!slug) return null

  const { data } = await admin.from('boards')
    .select('id, slug, name, category, subcategory, gym_id, state')
    .eq('slug', slug)
    .maybeSingle()
  if (!data) return null
  return { kind: 'board', board: data as BoardRow, label: `p/${data.slug}` }
}

// FK hints are required: the boards table added second join paths from
// hall_posts to both profiles and gyms, so bare embeds are ambiguous (PGRST201)
const POST_COLS = 'id, gym_id, board_id, profile_id, content, image_url, link_url, link_title, link_image, link_domain, score, comment_count, created_at, party, profiles!hall_posts_profile_id_fkey(username, avatar_url), gyms!hall_posts_gym_id_fkey(city_name, state)'

// Feed for any resolved board. sort: 'top' (score) | 'new'
export async function fetchBoardPosts(admin: any, rb: ResolvedBoard, sort: 'top' | 'new', limit = 60) {
  const order = (q: any) =>
    q.order(sort === 'new' ? 'created_at' : 'score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)
  const base = () => admin.from('hall_posts').select(POST_COLS).eq('hidden', false)

  if (rb.kind === 'all') return (await order(base())).data ?? []
  if (rb.kind === 'party') return (await order(base().eq('party', rb.key))).data ?? []

  const { board } = rb
  if (board.category === 'local' && board.gym_id) {
    return (await order(base().eq('gym_id', board.gym_id))).data ?? []
  }
  if (board.category === 'state' && board.state) {
    // union: posts made directly on the state board + every hall post in state
    const code = Object.entries(STATE_NAMES).find(([, n]) => n === board.name)?.[0] ?? board.state
    const [direct, halls] = await Promise.all([
      order(base().eq('board_id', board.id)),
      order(base().not('gyms', 'is', null).eq('gyms.state', code)),
    ])
    const seen = new Set<string>()
    const merged = [...(direct.data ?? []), ...(halls.data ?? [])].filter((p: any) =>
      seen.has(p.id) ? false : (seen.add(p.id), true))
    merged.sort((a: any, b: any) => sort === 'new'
      ? +new Date(b.created_at) - +new Date(a.created_at)
      : (b.score - a.score) || (+new Date(b.created_at) - +new Date(a.created_at)))
    return merged.slice(0, limit)
  }
  return (await order(base().eq('board_id', board.id))).data ?? []
}

// Featured tab strip, in Michael's order (p/profile is appended by the UI)
export const FEATURED_TABS = ['all', 'videos', 'politics', 'democrats', 'republicans', 'sports', 'space', 'movies']

// Psub banner — replaces the "📰 p/name" header on board pages.
// p/all = the gloves logo; states + locals = the state flag; teams = club
// colors; topics = themed gradients; community = purple.
import { TEAM_COLORS } from '@/config/team-colors'

const TOPIC_STYLES: Record<string, { bg: string; emoji: string }> = {
  videos: { bg: 'linear-gradient(120deg, #7f1d1d 0%, #b91c1c 55%, #1c1917 100%)', emoji: '▶️' },
  politics: { bg: 'linear-gradient(120deg, #1e3a8a 0%, #312e81 50%, #7f1d1d 100%)', emoji: '🏛️' },
  democrats: { bg: 'linear-gradient(120deg, #1e3a8a 0%, #2563eb 60%, #60a5fa 100%)', emoji: '🔵' },
  republicans: { bg: 'linear-gradient(120deg, #7f1d1d 0%, #dc2626 60%, #f87171 100%)', emoji: '🔴' },
  sports: { bg: 'linear-gradient(120deg, #14532d 0%, #166534 55%, #052e16 100%)', emoji: '🏆' },
  space: { bg: 'radial-gradient(circle at 25% 20%, #312e81 0%, #0c0a1f 55%, #000 100%)', emoji: '🚀' },
  movies: { bg: 'linear-gradient(120deg, #78350f 0%, #b45309 55%, #1c1917 100%)', emoji: '🎬' },
  funny: { bg: 'linear-gradient(120deg, #a16207 0%, #eab308 55%, #713f12 100%)', emoji: '😂' },
  news: { bg: 'linear-gradient(120deg, #334155 0%, #1e293b 55%, #0f172a 100%)', emoji: '🗞️' },
}

export default function BoardBanner({ label, slug, category, subcategory, state, name }: {
  label: string // "p/minnesota-vikings"
  slug: string
  category?: string | null // topic | sports | state | local | user | virtual (all/party)
  subcategory?: string | null
  state?: string | null
  name?: string | null
}) {
  const isAll = slug === 'all'
  const flag = (category === 'state' || category === 'local') && state
    ? `/banners/state/${state.toLowerCase()}.png` : null
  const team = category === 'sports' ? TEAM_COLORS[slug] : null
  const topic = TOPIC_STYLES[slug]

  const bg = team
    ? `linear-gradient(115deg, ${team[0]} 0%, ${team[0]} 45%, ${team[1]} 45.5%, ${team[1]} 100%)`
    : topic ? topic.bg
    : slug === 'democrat' || slug === 'democrats' ? TOPIC_STYLES.democrats.bg
    : slug === 'republican' || slug === 'republicans' ? TOPIC_STYLES.republicans.bg
    : category === 'user' ? 'linear-gradient(120deg, #4c1d95 0%, #6d28d9 55%, #2e1065 100%)'
    : 'linear-gradient(120deg, #1f2937 0%, #111827 100%)'

  return (
    <div className="relative w-full h-28 sm:h-32 rounded-2xl overflow-hidden border border-gray-800 shadow-lg">
      {isAll ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/banners/all.png" alt="PoliticsGo" className="absolute inset-0 w-full h-full object-cover" />
      ) : flag ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={flag} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0" style={{ background: bg }} />
      )}
      {/* readability scrim + name */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.72) 100%)' }} />
      <div className="absolute bottom-2.5 left-3.5 right-3.5 flex items-end justify-between">
        <div>
          <span className="text-white font-black text-xl sm:text-2xl uppercase tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
            style={{ fontFamily: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' }}>
            {category === 'sports' && name ? name : label}
          </span>
          {category === 'local' && name && (
            <span className="block text-white/70 text-[11px] font-bold -mt-0.5">{name} · town square</span>
          )}
        </div>
        {topic && <span className="text-2xl drop-shadow">{topic.emoji}</span>}
      </div>
    </div>
  )
}

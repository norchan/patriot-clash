import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fetchHalls } from '@/lib/halls'
import { fighterLevel } from '@/lib/fighter'
import BattleMap from '@/components/BattleMap'

// THE HOMEPAGE — the live national Battle Map, free for everyone.
// Signed-out: sign-up pitch sidebar. Signed-in: your profile sidebar.
// Below the map: the p/ post boards. Other sidebar: the arcade.
// (Installed apps skip this — manifest start_url is /map.)

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const ARCADE = [
  { id: 'spotit', name: 'Pic Hunt', art: '/arcade/spotit.jpg', accent: '#38bdf8' },
  { id: 'landslide', name: 'Landslide', art: '/arcade/landslide.jpg', accent: '#f472b6' },
  { id: 'tetkris', name: 'Tet-Kris', art: '/arcade/tetkris.jpg', accent: '#c084fc' },
  { id: 'chess', name: 'Checkmate Chamber', art: '/arcade/chess.jpg', accent: '#ffd700' },
  { id: 'slots', name: 'Slots Salute', art: '/arcade/slots.jpg', accent: '#facc15' },
]

export default async function HomePage() {
  const { userId } = await auth()
  const admin = createSupabaseAdminClient()

  let profile: any = null
  if (userId) {
    const { data } = await admin
      .from('profiles')
      .select('id, username, party, fp_balance, avatar_url, total_battles_won')
      .eq('clerk_user_id', userId)
      .single()
    if (!data) {
      const { createProfileForUser } = await import('@/lib/auth')
      await createProfileForUser(userId, '', `player_${userId.slice(-6)}`)
      redirect('/onboarding')
    }
    if (!data.party) redirect('/onboarding')
    profile = data
  }

  const [halls, { data: posts }] = await Promise.all([
    fetchHalls(),
    admin.from('hall_posts')
      .select('id, content, score, comment_count, created_at, party, profiles(username), gyms(city_name, state)')
      .eq('hidden', false)
      .order('score', { ascending: false })
      .limit(12),
  ])
  const dem = halls.filter(h => h.party === 'democrat').length
  const rep = halls.filter(h => h.party === 'republican').length

  const partyColor = profile?.party === 'democrat' ? '#60a5fa' : '#f87171'

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* header */}
      <header className="border-b border-gray-800/70 bg-gray-950/80 sticky top-0 z-30 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className="font-black text-white text-lg">PoliticsGo</span>
          </div>
          <nav className="flex items-center gap-2">
            {profile ? (
              <Link href="/map" className="px-4 py-2 rounded-xl font-black text-white text-sm"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                🗺️ Open the game
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="px-3 py-2 text-sm font-bold text-gray-400 hover:text-white">Sign in</Link>
                <Link href="/sign-up" className="px-4 py-2 rounded-xl font-black text-white text-sm"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                  Play free
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-5 grid gap-5 lg:grid-cols-[270px_minmax(0,1fr)_270px]">
        {/* ── LEFT SIDEBAR: profile or sign-up pitch ─────────────────────── */}
        <aside className="order-2 lg:order-1 space-y-4">
          {profile ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center gap-3">
                {profile.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={profile.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover border-2" style={{ borderColor: partyColor }} />
                  : <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-black text-white" style={{ background: partyColor }}>
                      {(profile.username ?? 'P')[0].toUpperCase()}
                    </div>}
                <div className="min-w-0">
                  <p className="font-black text-white truncate">{profile.username}</p>
                  <p className="text-xs font-bold" style={{ color: partyColor }}>
                    {profile.party === 'democrat' ? '🔵 Democrat' : '🔴 Republican'} · Lv {fighterLevel(profile.total_battles_won ?? 0)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-gray-400">⚡ <b className="text-yellow-400">{Number(profile.fp_balance ?? 0).toLocaleString()}</b> FP</p>
              <div className="mt-4 grid gap-2">
                <Link href="/map" className="py-2.5 rounded-xl text-center font-black text-white text-sm" style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>🗺️ Map</Link>
                <Link href="/profile" className="py-2.5 rounded-xl text-center font-bold text-gray-200 text-sm bg-white/5 hover:bg-white/10">👤 Profile</Link>
                <Link href="/messages" className="py-2.5 rounded-xl text-center font-bold text-gray-200 text-sm bg-white/5 hover:bg-white/10">💬 Messages</Link>
                <Link href="/arena" className="py-2.5 rounded-xl text-center font-bold text-gray-200 text-sm bg-white/5 hover:bg-white/10">🏟️ Arena</Link>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl p-5 border"
              style={{ background: 'linear-gradient(160deg, #1b1033, #0d0719)', borderColor: 'rgba(139,92,246,0.5)' }}>
              <div className="text-3xl">🗣️</div>
              <h2 className="mt-2 text-white font-black text-xl leading-tight">Make your voice heard</h2>
              <p className="mt-2 text-sm text-gray-300">
                Pick your party. Walk your real streets. Capture your real town hall — and hold it for your side.
              </p>
              <ul className="mt-3 space-y-1.5 text-[13px] text-gray-400">
                <li>🏛️ 2,000+ real American town halls</li>
                <li>🥊 Battle rival sprites &amp; real players</li>
                <li>🚶 Walking earns Fighting Points</li>
                <li>📰 Post in your town square</li>
              </ul>
              <Link href="/sign-up" className="block mt-4 py-3 rounded-xl text-center font-black text-white"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                Join the fight — free
              </Link>
              <p className="mt-2 text-center text-xs text-gray-500">
                Already enlisted? <Link href="/sign-in" className="text-purple-400 font-bold hover:text-purple-300">Sign in</Link>
              </p>
            </div>
          )}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 text-sm">
            <p className="font-black text-white mb-2">📊 The war today</p>
            <p className="text-blue-400 font-black">🔵 Democrats {dem.toLocaleString()}</p>
            <p className="text-red-400 font-black mt-1">🔴 Republicans {rep.toLocaleString()}</p>
            <Link href="/explore/scoreboard" className="mt-2 inline-block text-xs text-purple-400 font-bold hover:text-purple-300">State-by-state numbers →</Link>
          </div>
        </aside>

        {/* ── CENTER: the battle map + boards ────────────────────────────── */}
        <main className="order-1 lg:order-2 min-w-0">
          <div className="flex items-baseline justify-between mb-2">
            <h1 className="text-xl sm:text-2xl font-black text-white">🗺️ The Battle Map</h1>
            <Link href="/battlemap" className="text-xs font-bold text-purple-400 hover:text-purple-300">Full screen →</Link>
          </div>
          <BattleMap halls={halls} height="56vh" />

          <div className="mt-6 flex items-baseline justify-between">
            <h2 className="text-lg font-black text-white">📰 Live from the town squares</h2>
            <Link href="/p/all" className="text-xs font-bold text-purple-400 hover:text-purple-300">p/all →</Link>
          </div>
          <div className="mt-3 space-y-3">
            {(posts ?? []).length === 0 && (
              <p className="text-gray-600 text-sm text-center py-8">Quiet out there right now — check back soon.</p>
            )}
            {(posts ?? []).map((p: any) => (
              <article key={p.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {p.party && (
                    <span className="font-black" style={{ color: p.party === 'democrat' ? '#60a5fa' : '#f87171' }}>
                      {p.party === 'democrat' ? 'DEM' : 'REP'}
                    </span>
                  )}
                  <span className="font-bold text-gray-400">{p.profiles?.username ?? 'Player'}</span>
                  {p.gyms && <span>· {p.gyms.city_name}, {p.gyms.state}</span>}
                  <span>· {timeAgo(p.created_at)}</span>
                </div>
                <p className="mt-2 text-gray-200 text-sm whitespace-pre-wrap break-words">{p.content}</p>
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 font-bold">
                  <span>▲ {p.score}</span>
                  <span>💬 {p.comment_count}</span>
                </div>
              </article>
            ))}
          </div>
          <Link href="/p/all" className="block mt-4 py-2.5 rounded-xl text-center text-sm font-bold text-gray-300 bg-white/5 hover:bg-white/10">
            See every board →
          </Link>
        </main>

        {/* ── RIGHT SIDEBAR: the arcade ──────────────────────────────────── */}
        <aside className="order-3 space-y-4">
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <p className="font-black text-white mb-3">🕹️ The Arcade</p>
            <div className="grid gap-3">
              {ARCADE.map(g => (
                <Link key={g.id} href={profile ? `/arcade/${g.id}` : '/sign-up'}
                  className="group relative rounded-xl overflow-hidden border border-gray-800 hover:border-gray-600 transition block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.art} alt={g.name} className="w-full h-24 object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  <div className="absolute inset-0 flex items-end p-2.5"
                    style={{ background: 'linear-gradient(180deg, transparent 30%, rgba(3,7,18,0.9))' }}>
                    <span className="font-black text-sm" style={{ color: g.accent }}>{g.name}</span>
                  </div>
                </Link>
              ))}
            </div>
            <Link href="/explore/leaderboards" className="mt-3 inline-block text-xs text-purple-400 font-bold hover:text-purple-300">🏆 Leaderboards →</Link>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 text-sm">
            <p className="font-black text-white mb-2">🧭 Explore</p>
            <div className="grid gap-1.5 text-[13px]">
              <Link href="/explore/characters" className="text-gray-400 hover:text-white">🎭 The characters</Link>
              <Link href="/explore/guide" className="text-gray-400 hover:text-white">📖 How to play</Link>
              <Link href="/explore/news" className="text-gray-400 hover:text-white">🗞️ Dispatches</Link>
              <Link href="/explore/faq" className="text-gray-400 hover:text-white">❓ FAQ</Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

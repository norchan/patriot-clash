import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// PUBLIC leaderboards: every arcade game + the PvP Arena. Revalidates 5 min.
export const revalidate = 300

export const metadata: Metadata = {
  title: 'PoliticsGo Leaderboards — arcade records & arena champions',
  description:
    'The best PoliticsGo players in the country: arcade records for Pic Hunt, Checkmate Chamber, Landslide, Tet-Kris and the slots, plus the PvP Arena daily and all-time champions.',
  alternates: { canonical: 'https://politicsgo.app/explore/leaderboards' },
}

const GAMES: { id: string; label: string; emoji: string; unit: (v: number) => string }[] = [
  { id: 'spotit', label: 'Pic Hunt — fastest sweep', emoji: '🔍', unit: v => `${v}s left` },
  { id: 'chess', label: 'Checkmate Chamber — longest streak', emoji: '♟', unit: v => `${v} in a row` },
  { id: 'landslide', label: 'Landslide — best run', emoji: '⛰', unit: v => v.toLocaleString() },
  { id: 'tetkris', label: 'Tet-Kris — high score', emoji: '🧱', unit: v => v.toLocaleString() },
  { id: 'slots', label: 'Slots Salute — biggest single win', emoji: '🎰', unit: v => `${v.toLocaleString()} FP` },
]
const MEDALS = ['🥇', '🥈', '🥉']

export default async function LeaderboardsPage() {
  const admin = createSupabaseAdminClient()

  const boards = await Promise.all(GAMES.map(async g => {
    const { data } = await admin
      .from('arcade_bests')
      .select('profile_id, best_score, profiles(username, party)')
      .eq('game', g.id)
      .order('best_score', { ascending: false })
      .limit(10)
    return { ...g, rows: data ?? [] }
  }))

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
  const [{ data: today }, { data: alltime }] = await Promise.all([
    admin.rpc('arena_rankings', { p_since: dayStart.toISOString(), p_limit: 10 }),
    admin.rpc('arena_rankings', { p_since: null, p_limit: 10 }),
  ])

  const Row = ({ i, name, party, value }: { i: number; name: string; party?: string | null; value: string }) => (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-900 last:border-0">
      <span className="w-7 text-center font-black text-sm">{MEDALS[i] ?? i + 1}</span>
      <span className="w-2 h-2 rounded-full shrink-0"
        style={{ background: party === 'democrat' ? '#3b82f6' : party === 'republican' ? '#ef4444' : '#6b7280' }} />
      <span className="flex-1 font-bold text-white text-sm truncate">{name}</span>
      <span className="text-yellow-300 font-black text-sm">{value}</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">Leaderboards</h1>
        <p className="mt-2 text-gray-400">The best players in the country, updated all day.</p>

        <h2 className="text-xl font-bold text-white mt-8">🏟️ Arena — Today&apos;s Champions</h2>
        <div className="mt-3 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {(today ?? []).length === 0
            ? <p className="text-gray-600 text-sm text-center py-5">No fights settled yet today — the first win takes the crown.</p>
            : (today ?? []).map((r: any, i: number) => <Row key={r.profile_id} i={i} name={r.username} party={r.party} value={`${r.wins} wins`} />)}
        </div>
        <h2 className="text-xl font-bold text-white mt-6">👑 Arena — All-Time Greats</h2>
        <div className="mt-3 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {(alltime ?? []).length === 0
            ? <p className="text-gray-600 text-sm text-center py-5">History unwritten.</p>
            : (alltime ?? []).map((r: any, i: number) => <Row key={r.profile_id} i={i} name={r.username} party={r.party} value={`${r.wins} wins`} />)}
        </div>

        {boards.map(b => (
          <div key={b.id}>
            <h2 className="text-xl font-bold text-white mt-6">{b.emoji} {b.label}</h2>
            <div className="mt-3 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {b.rows.length === 0
                ? <p className="text-gray-600 text-sm text-center py-5">No records yet — set the first one.</p>
                : b.rows.map((r: any, i: number) => (
                    <Row key={r.profile_id} i={i} name={r.profiles?.username ?? 'Player'} party={r.profiles?.party} value={b.unit(r.best_score)} />
                  ))}
            </div>
          </div>
        ))}

        <div className="mt-10 rounded-2xl border border-purple-800 bg-purple-950/30 p-5 text-center">
          <p className="text-gray-300 text-sm">Think you belong up here? Prove it.</p>
          <Link href="/" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Play PoliticsGo free
          </Link>
        </div>
      </div>
    </div>
  )
}

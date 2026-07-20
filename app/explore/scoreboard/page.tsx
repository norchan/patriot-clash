import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// PUBLIC live scoreboard: which party controls America's town halls, state by
// state — unique, auto-updating data content. Revalidates every 10 minutes.
export const revalidate = 600

export const metadata: Metadata = {
  title: 'The PoliticsGo National Scoreboard — who controls America?',
  description:
    'Live standings of the PoliticsGo map war: how many town halls each party controls nationally and in every state, updated throughout the day.',
  alternates: { canonical: 'https://politicsgo.app/explore/scoreboard' },
}

const STATE_NAMES: Record<string, string> = {
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

export default async function ScoreboardPage() {
  const admin = createSupabaseAdminClient()
  // hall counts by state and party (paginated past the 1k row cap)
  const rows: { state: string; holder_party: string | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('gyms')
      .select('state, holder_party')
      .eq('is_active', true)
      .range(from, from + 999)
    if (!data?.length) break
    rows.push(...(data as any))
    if (data.length < 1000) break
  }
  const byState = new Map<string, { dem: number; rep: number; open: number }>()
  let dem = 0, rep = 0, open = 0
  for (const r of rows) {
    const s = byState.get(r.state) ?? { dem: 0, rep: 0, open: 0 }
    if (r.holder_party === 'democrat') { s.dem++; dem++ }
    else if (r.holder_party === 'republican') { s.rep++; rep++ }
    else { s.open++; open++ }
    byState.set(r.state, s)
  }
  const total = rows.length || 1
  const states = [...byState.entries()].sort((a, b) => (b[1].dem + b[1].rep + b[1].open) - (a[1].dem + a[1].rep + a[1].open))
  const updated = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' })

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">The National Scoreboard</h1>
        <p className="mt-2 text-gray-400">
          {rows.length.toLocaleString()} real town halls across America are capturable territory
          in PoliticsGo. This is the live state of the map war — updated all day as players
          capture and defend.
        </p>
        <p className="text-gray-600 text-xs mt-1">Last updated {updated} CT</p>

        {/* national bar */}
        <div className="mt-8">
          <div className="flex justify-between text-sm font-black">
            <span className="text-blue-400">🔵 Democrats · {dem.toLocaleString()}</span>
            <span className="text-gray-500">{open ? `${open} unclaimed` : ''}</span>
            <span className="text-red-400">Republicans · {rep.toLocaleString()} 🔴</span>
          </div>
          <div className="mt-2 h-6 rounded-full overflow-hidden flex border border-gray-800">
            <div style={{ width: `${(dem / total) * 100}%`, background: 'linear-gradient(90deg,#1d4ed8,#3b82f6)' }} />
            <div style={{ width: `${(open / total) * 100}%`, background: '#374151' }} />
            <div style={{ width: `${(rep / total) * 100}%`, background: 'linear-gradient(90deg,#ef4444,#b91c1c)' }} />
          </div>
          <p className="text-center text-gray-400 text-sm mt-2 font-bold">
            {dem === rep ? 'Dead even. America, somehow, remains tied.'
              : dem > rep ? `Democrats lead by ${(dem - rep).toLocaleString()} halls`
              : `Republicans lead by ${(rep - dem).toLocaleString()} halls`}
          </p>
        </div>

        <h2 className="text-xl font-bold text-white mt-10">State by state</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs text-left border-b border-gray-800">
                <th className="py-2 pr-2">State</th>
                <th className="py-2 pr-2 text-blue-400">Dem</th>
                <th className="py-2 pr-2 text-red-400">Rep</th>
                <th className="py-2 pr-2">Control</th>
              </tr>
            </thead>
            <tbody>
              {states.map(([st, s]) => {
                const stTotal = s.dem + s.rep + s.open || 1
                return (
                  <tr key={st} className="border-b border-gray-900">
                    <td className="py-2 pr-2 font-bold text-white">{STATE_NAMES[st] ?? st}</td>
                    <td className="py-2 pr-2 text-blue-300">{s.dem}</td>
                    <td className="py-2 pr-2 text-red-300">{s.rep}</td>
                    <td className="py-2 pr-2 w-1/3">
                      <div className="h-2.5 rounded-full overflow-hidden flex bg-gray-800">
                        <div style={{ width: `${(s.dem / stTotal) * 100}%`, background: '#3b82f6' }} />
                        <div style={{ width: `${(s.open / stTotal) * 100}%`, background: '#4b5563' }} />
                        <div style={{ width: `${(s.rep / stTotal) * 100}%`, background: '#ef4444' }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-10 rounded-2xl border border-purple-800 bg-purple-950/30 p-5 text-center">
          <p className="text-gray-300 text-sm">Your town is on this map. Go claim it.</p>
          <Link href="/" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Play PoliticsGo free
          </Link>
        </div>
        <footer className="mt-10 text-center text-gray-600 text-xs space-x-3">
          <Link href="/explore/guide" className="hover:text-gray-400">How to Play</Link>
          <Link href="/explore/characters" className="hover:text-gray-400">Characters</Link>
          <Link href="/explore/news" className="hover:text-gray-400">News</Link>
        </footer>
      </div>
    </div>
  )
}

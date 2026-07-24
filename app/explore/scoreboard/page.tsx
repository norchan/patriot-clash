import Link from 'next/link'
import type { Metadata } from 'next'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// PUBLIC live scoreboard: two selectable views (Michael 2026-07-23) —
//   State by state  = which party controls the town halls (live)
//   Player by player = party enlistment per state
// The view picker sits ABOVE the national count. Revalidates every 10 min.
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

// Presentation-layer enlistment boost (Michael 2026-07-23): the player view
// shows each party's REAL count plus exactly 25,000 "national guard" per
// side, spread population-weighted-with-jitter across the states — CA gets
// the most, NV the least. Fixed tables so the page is stable between
// rebuilds; each sums to exactly 25,000. Real counts are added on top.
const GHOST_DEM: Record<string, number> = { TX: 2266, RI: 80, IN: 425, PA: 911, NC: 726, AL: 461, WY: 46, NE: 136, FL: 2115, AR: 272, WI: 463, VA: 670, GA: 651, MD: 414, CT: 335, NY: 1346, TN: 534, HI: 86, DC: 64, DE: 94, AZ: 673, VT: 51, ME: 94, WA: 609, MN: 382, KS: 188, IA: 198, KY: 293, IL: 786, NJ: 633, ND: 54, MA: 466, OH: 816, SD: 66, NM: 143, NH: 95, AK: 63, UT: 260, MO: 416, NV: 25, OK: 277, CA: 3598, CO: 538, MS: 195, LA: 301, OR: 292, MI: 669, SC: 390, MT: 74, WV: 142, ID: 118 }
const GHOST_REP: Record<string, number> = { AZ: 467, WY: 52, WI: 525, NE: 156, PA: 1043, DE: 66, NJ: 727, VA: 761, LA: 347, IL: 910, UT: 296, SC: 445, AK: 44, DC: 45, IA: 230, MD: 476, OR: 335, OK: 318, OH: 936, ID: 137, WA: 692, SD: 76, IN: 492, MN: 440, CO: 378, ME: 107, TN: 607, NC: 833, NY: 1543, NM: 164, AR: 188, ND: 62, MO: 478, VT: 57, NH: 109, TX: 2517, CA: 2578, RI: 91, HI: 99, MA: 536, KS: 217, MS: 224, MI: 769, GA: 756, MT: 85, KY: 338, NV: 24, WV: 161, AL: 319, CT: 235, FL: 1509 }

export default async function ScoreboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  const playersView = view === 'players'
  const admin = createSupabaseAdminClient()

  // ── hall control by state (the original view) ────────────────────────────
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
  const hallsByState = new Map<string, { dem: number; rep: number; open: number }>()
  let hallDem = 0, hallRep = 0, hallOpen = 0
  for (const r of rows) {
    const s = hallsByState.get(r.state) ?? { dem: 0, rep: 0, open: 0 }
    if (r.holder_party === 'democrat') { s.dem++; hallDem++ }
    else if (r.holder_party === 'republican') { s.rep++; hallRep++ }
    else { s.open++; hallOpen++ }
    hallsByState.set(r.state, s)
  }

  // ── players by state (party enlistment incl. the national-guard boost) ───
  const playersByState = new Map<string, { dem: number; rep: number }>()
  let playerDem = 0, playerRep = 0
  if (playersView) {
    const pRows: { party: string | null; gyms: { state: string } | null }[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await admin.from('profiles')
        .select('party, gyms!profiles_home_gym_id_fkey(state)')
        .not('home_gym_id', 'is', null)
        .range(from, from + 999)
      if (!data?.length) break
      pRows.push(...(data as any))
      if (data.length < 1000) break
    }
    for (const st of Object.keys(GHOST_DEM)) {
      playersByState.set(st, { dem: GHOST_DEM[st] ?? 0, rep: GHOST_REP[st] ?? 0 })
    }
    for (const p of pRows) {
      const st = (p as any).gyms?.state
      if (!st) continue
      const s = playersByState.get(st) ?? { dem: 0, rep: 0 }
      if (p.party === 'democrat') s.dem++
      else if (p.party === 'republican') s.rep++
      playersByState.set(st, s)
    }
    for (const s of playersByState.values()) { playerDem += s.dem; playerRep += s.rep }
  }

  const dem = playersView ? playerDem : hallDem
  const rep = playersView ? playerRep : hallRep
  const open = playersView ? 0 : hallOpen
  const total = (dem + rep + open) || 1

  const states = playersView
    ? [...playersByState.entries()].map(([st, s]) => [st, { ...s, open: 0 }] as [string, { dem: number; rep: number; open: number }])
        .sort((a, b) => (b[1].dem + b[1].rep) - (a[1].dem + a[1].rep))
    : [...hallsByState.entries()].sort((a, b) => (b[1].dem + b[1].rep + b[1].open) - (a[1].dem + a[1].rep + a[1].open))

  const updated = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' })

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">The National Scoreboard</h1>
        <p className="mt-2 text-gray-400">
          {playersView
            ? `${(playerDem + playerRep).toLocaleString()} players are enlisted in the PoliticsGo map war. This is where each party's army lives — updated as new fighters join.`
            : `${rows.length.toLocaleString()} real town halls across America are capturable territory in PoliticsGo. This is the live state of the map war — updated all day as players capture and defend.`}
        </p>
        <p className="text-gray-600 text-xs mt-1">Last updated {updated} CT</p>

        {/* the view picker — ABOVE the national count (Michael) */}
        <div className="mt-8 inline-flex rounded-xl border border-gray-700 bg-gray-900 p-1">
          <Link href="/explore/scoreboard"
            className={`px-4 py-2 rounded-lg text-sm font-black transition ${!playersView ? 'bg-purple-700 text-white' : 'text-gray-400 hover:text-white'}`}>
            State by state
          </Link>
          <Link href="/explore/scoreboard?view=players"
            className={`px-4 py-2 rounded-lg text-sm font-black transition ${playersView ? 'bg-purple-700 text-white' : 'text-gray-400 hover:text-white'}`}>
            Player by player
          </Link>
        </div>

        {/* national bar */}
        <div className="mt-5">
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
              : dem > rep
                ? `Democrats lead by ${(dem - rep).toLocaleString()} ${playersView ? 'players' : 'halls'}`
                : `Republicans lead by ${(rep - dem).toLocaleString()} ${playersView ? 'players' : 'halls'}`}
          </p>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs text-left border-b border-gray-800">
                <th className="py-2 pr-2">State</th>
                <th className="py-2 pr-2 text-blue-400">Dem</th>
                <th className="py-2 pr-2 text-red-400">Rep</th>
                <th className="py-2 pr-2">{playersView ? 'Enlistment' : 'Control'}</th>
              </tr>
            </thead>
            <tbody>
              {states.map(([st, s]) => {
                const stTotal = s.dem + s.rep + s.open || 1
                return (
                  <tr key={st} className="border-b border-gray-900">
                    <td className="py-2 pr-2 font-bold text-white">{STATE_NAMES[st] ?? st}</td>
                    <td className="py-2 pr-2 text-blue-300">{s.dem.toLocaleString()}</td>
                    <td className="py-2 pr-2 text-red-300">{s.rep.toLocaleString()}</td>
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

'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Swords } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

// THE FIGHT LOBBY (Michael 2026-07-24): your fighter waits in the White
// House press room while your queued fights line up. Shows a wait counter
// and every armed fight (either side); tapping one enters the ring — the
// 3-2-1 fires as soon as both players are in.

const PvpArena3D = dynamic(() => import('@/components/PvpArena3D'), { ssr: false })

interface QueuedFight {
  id: string
  opponent: string
  opponent_party: string | null
  i_am_challenger: boolean
  fp_stake: number
  accepted_at: string
  expires_at: string
  opponent_waiting: boolean
}

const partyColor = (p?: string | null) =>
  p === 'democrat' ? '#3b82f6' : p === 'republican' ? '#ef4444' : '#9ca3af'

export default function FightLobbyPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const [fights, setFights] = useState<QueuedFight[] | null>(null)
  const [waitSecs, setWaitSecs] = useState(0)
  const enteredAt = useRef(Date.now())

  // wait counter — how long you've been standing at the podium
  useEffect(() => {
    const iv = setInterval(() => setWaitSecs(Math.floor((Date.now() - enteredAt.current) / 1000)), 1000)
    return () => clearInterval(iv)
  }, [])

  // queued fights, refreshed every 4s — new challenges appear while you wait
  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/pvp/queue').then(r => r.json())
      .then(d => { if (alive) setFights(d.fights ?? []) }).catch(() => {})
    load()
    const iv = setInterval(load, 4000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  const partySuffix = profile?.party === 'republican' ? 'rep' : 'dem'
  const myFighter = `${(profile as any)?.pvp_fighter ?? 'fighter1'}_${partySuffix}`
  const myHead = (profile as any)?.head_id ?? null
  const mm = String(Math.floor(waitSecs / 60)).padStart(1, '0')
  const ss = String(waitSecs % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 bg-gray-950 overflow-hidden">
      {/* your fighter at the press-room podium */}
      <div className="absolute inset-0">
        {profile && (
          <PvpArena3D playerPrefix={myFighter} playerHeadId={myHead} solo arena="pressroom" />
        )}
      </div>
      <div className="absolute inset-x-0 top-0 h-28 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(3,7,18,0.9), transparent)' }} />
      <div className="absolute inset-x-0 bottom-0 h-64 pointer-events-none"
        style={{ background: 'linear-gradient(0deg, rgba(3,7,18,0.95) 30%, transparent)' }} />

      {/* header: back + title + wait counter */}
      <div className="absolute top-0 inset-x-0 z-10 px-4 pt-4 flex items-center gap-3">
        <button onClick={() => router.push('/arena')} className="text-white/80 hover:text-white"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <h1 className="text-white font-black text-lg leading-tight" style={{ textShadow: '0 2px 8px #000' }}>Fight Lobby</h1>
          <p className="text-gray-300 text-[11px] font-bold" style={{ textShadow: '0 1px 4px #000' }}>The press room — where fighters wait</p>
        </div>
        <div className="text-right">
          <p className="text-gray-400 text-[9px] font-black uppercase tracking-wider">Waiting</p>
          <p className="text-white font-black text-xl tabular-nums" style={{ textShadow: '0 2px 8px #000' }}>{mm}:{ss}</p>
        </div>
      </div>

      {/* queued fights */}
      <div className="absolute bottom-0 inset-x-0 z-10 px-4 pb-6">
        <p className="text-amber-300 text-[10px] font-black uppercase tracking-[0.2em] mb-2" style={{ textShadow: '0 1px 4px #000' }}>
          ⚔️ Queued fights
        </p>
        {fights === null ? (
          <p className="text-gray-400 text-sm font-bold">Checking the card…</p>
        ) : fights.length === 0 ? (
          <div className="rounded-2xl bg-gray-900/90 border border-gray-700 p-4">
            <p className="text-gray-300 text-sm font-bold">No fights queued.</p>
            <p className="text-gray-500 text-xs mt-1">Challenge someone on the map, take on an Arena bot, or share your fight link — new challenges show up here the moment they land.</p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => router.push('/map')}
                className="flex-1 py-2.5 rounded-xl font-black text-sm text-white"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                🗺️ Find a fight
              </button>
              <button onClick={() => router.push('/arena')}
                className="flex-1 py-2.5 rounded-xl font-black text-sm text-white bg-gray-800 border border-gray-700">
                🏟️ Arena
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {fights.map(f => {
              const waitedFor = Math.max(0, Math.floor((Date.now() - new Date(f.accepted_at).getTime()) / 1000))
              const expiresIn = Math.max(0, Math.floor((new Date(f.expires_at).getTime() - Date.now()) / 1000))
              return (
                <button key={f.id}
                  onClick={() => router.push(`/battle/pvp?id=${f.id}`)}
                  className="w-full rounded-2xl bg-gray-900/95 border p-3.5 flex items-center gap-3 text-left transition active:scale-[0.98] hover:bg-gray-800"
                  style={{ borderColor: `${partyColor(f.opponent_party)}66` }}>
                  <span className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-black text-white shrink-0"
                    style={{ background: partyColor(f.opponent_party) }}>
                    {f.opponent?.[0]?.toUpperCase() ?? '?'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white font-black text-sm truncate">vs {f.opponent}</span>
                    <span className="block text-gray-400 text-[11px] font-bold">
                      {f.opponent_waiting ? '🟢 In the ring waiting' : '🕐 Queued'} · {waitedFor}s ago · expires in {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, '0')}
                    </span>
                  </span>
                  <span className="shrink-0 px-3.5 py-2 rounded-xl font-black text-xs text-white flex items-center gap-1.5"
                    style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                    <Swords size={13} /> ENTER
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

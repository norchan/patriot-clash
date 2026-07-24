'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Swords, Trophy, Brush } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

// THE ARENA — national fight hub. Browse opponents by level bracket and
// challenge them, climb the daily + all-time national rankings, and tune
// your fighter. Landmarked on the map next to your LOCAL town hall only.

interface Opponent { id: string; username: string; party: string | null; avatar_url: string | null; level: number; wins: number; losses: number; is_bot: boolean }
interface RankRow { profile_id: string; username: string; party: string | null; wins: number }
interface ArenaData { me: { id: string; level: number; wins: number; fp: number }; opponents: Opponent[]; today: RankRow[]; alltime: RankRow[] }

const BRACKETS = [
  { key: 'all', label: 'ALL LEVELS' },
  { key: 'rookie', label: 'ROOKIE 1-4' },
  { key: 'contender', label: 'CONTENDER 5-9' },
  { key: 'veteran', label: 'VETERAN 10-19' },
  { key: 'elite', label: 'ELITE 20+' },
]
const MEDALS = ['🥇', '🥈', '🥉']

export default function ArenaPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const [bracket, setBracket] = useState('all')
  const [data, setData] = useState<ArenaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState<'today' | 'alltime'>('today')
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/arena?bracket=${bracket}`).then(r => r.json())
      .then(d => { if (!d.error) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [bracket])

  async function challenge(o: Opponent) {
    if (busy) return
    setBusy(o.id)
    try {
      const res = await fetch('/api/pvp/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defender_id: o.id }),
      })
      const d = await res.json()
      if (res.ok) {
        // Bots auto-accept — straight into the ring, no waiting
        if (d.status === 'accepted') {
          router.push(`/battle/pvp?id=${d.id}`)
          return
        }
        setSent(s => new Set(s).add(o.id))
        setToast(`⚔️ Challenge sent to ${o.username}!`)
      } else {
        setToast(`❌ ${d.error ?? d.message ?? 'Could not challenge'}`)
      }
    } catch { setToast('❌ Could not challenge') }
    setBusy(null)
    setTimeout(() => setToast(''), 2500)
  }

  const rankList = board === 'today' ? data?.today : data?.alltime

  return (
    <div className="min-h-screen text-white pb-28 select-none"
      style={{ background: 'radial-gradient(circle at 50% -20%, #7c2d12 0%, #431407 40%, #1a0a04 75%, #0c0502 100%)', fontFamily: 'ui-monospace, monospace' }}>
      {/* hero */}
      {/* pr-14 clears the game menu ☰ pinned top-right — the LV badge was
          hiding behind it (Michael) */}
      <div className="px-4 pt-4 pr-14 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-white/70 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.14em] text-xl" style={{ color: '#fbbf24', textShadow: '0 0 16px #d97706, 0 2px 0 #000' }}>THE ARENA</h1>
        {data && <span className="ml-auto text-xs font-black text-white/70">LV <span className="text-yellow-300 text-base">{data.me.level}</span></span>}
      </div>
      <div className="flex justify-center mt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/arena.png" alt="" className="w-52 h-auto pointer-events-none"
          style={{ filter: 'drop-shadow(0 0 24px rgba(217,119,6,0.45)) drop-shadow(0 8px 12px rgba(0,0,0,0.6))' }} />
      </div>
      <p className="text-center text-white/50 text-[11px] -mt-1 px-8">Find a fight. Climb the national rankings. Winner takes the glory.</p>

      {/* design your fighter */}
      <div className="max-w-md mx-auto px-4 mt-3">
        <button onClick={() => router.push('/fighter3d')}
          className="w-full py-3 rounded-xl font-black text-sm transition active:scale-95 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: '1px solid rgba(216,180,254,0.35)' }}>
          <Brush size={15} /> DESIGN YOUR FIGHTER
        </button>
      </div>

      {/* the Fight Lobby — the press room where queued fights wait */}
      <div className="max-w-md mx-auto px-4 mt-5">
        <button onClick={() => router.push('/lobby')}
          className="w-full py-3.5 rounded-2xl font-black text-white transition active:scale-[0.98] flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', boxShadow: '0 6px 24px rgba(29,78,216,0.35)' }}>
          🎙️ FIGHT LOBBY
          <span className="text-white/70 text-xs font-bold">· your queued fights</span>
        </button>
      </div>

      {/* find a fight */}
      <div className="max-w-md mx-auto px-4 mt-5">
        <h2 className="flex items-center gap-2 text-[12px] font-black tracking-widest text-orange-300 mb-2"><Swords size={14} /> FIND A FIGHT</h2>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {BRACKETS.map(b => (
            <button key={b.key} onClick={() => setBracket(b.key)}
              className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black transition"
              style={bracket === b.key
                ? { background: '#d97706', color: '#1a0a04' }
                : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>
              {b.label}
            </button>
          ))}
        </div>
        <div className="mt-2 rounded-2xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(217,119,6,0.25)' }}>
          {loading ? (
            <p className="text-white/40 text-sm text-center py-6">Scouting fighters…</p>
          ) : !data?.opponents.length ? (
            <p className="text-white/40 text-sm text-center py-6">No fighters in this bracket yet — try another.</p>
          ) : data.opponents.map(o => {
            const color = o.party === 'democrat' ? '#3b82f6' : o.party === 'republican' ? '#ef4444' : '#9ca3af'
            const isSent = sent.has(o.id)
            return (
              <div key={o.id} className="flex items-center gap-3 px-3 py-2.5 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <button onClick={() => router.push(`/player/${o.id}`)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                  {o.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border-2 shrink-0" style={{ borderColor: color }} />
                  ) : (
                    <div className="w-9 h-9 rounded-full border-2 shrink-0 flex items-center justify-center text-sm" style={{ borderColor: color, background: `${color}22` }}>
                      {o.party === 'democrat' ? '🔵' : '🔴'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{o.username}</div>
                    <div className="text-[10px] text-white/45">LV {o.level} · {o.wins}W-{o.losses}L</div>
                  </div>
                </button>
                <button onClick={() => challenge(o)} disabled={isSent || busy === o.id || (profile ? profile.fp_balance < 50 : false)}
                  className="shrink-0 px-3.5 py-2 rounded-full text-[11px] font-black transition active:scale-95 disabled:opacity-50"
                  style={isSent ? { background: 'rgba(255,255,255,0.1)', color: '#9ca3af' } : { background: 'linear-gradient(135deg,#d97706,#92400e)', color: '#fff' }}>
                  {isSent ? 'SENT ✓' : busy === o.id ? '…' : '⚔️ FIGHT'}
                </button>
              </div>
            )
          })}
        </div>
        <p className="text-white/35 text-[10px] text-center mt-1.5">Challenges cost 50 FP · winner takes the pot</p>
      </div>

      {/* rankings */}
      <div className="max-w-md mx-auto px-4 mt-6">
        <h2 className="flex items-center gap-2 text-[12px] font-black tracking-widest text-orange-300 mb-2"><Trophy size={14} /> NATIONAL RANKINGS</h2>
        <div className="flex gap-1.5 mb-2">
          {(['today', 'alltime'] as const).map(k => (
            <button key={k} onClick={() => setBoard(k)}
              className="flex-1 py-2 rounded-full text-[11px] font-black transition"
              style={board === k
                ? { background: '#fbbf24', color: '#1a0a04' }
                : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>
              {k === 'today' ? "TODAY'S CHAMPIONS" : 'ALL-TIME GREATS'}
            </button>
          ))}
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(251,191,36,0.25)' }}>
          {!rankList?.length ? (
            <p className="text-white/40 text-sm text-center py-6">{board === 'today' ? 'No fights settled yet today — be the first.' : 'The record books are empty. Make history.'}</p>
          ) : rankList.map((r, i) => {
            const color = r.party === 'democrat' ? '#3b82f6' : r.party === 'republican' ? '#ef4444' : '#9ca3af'
            const isMe = r.profile_id === data?.me.id
            return (
              <button key={r.profile_id} onClick={() => router.push(`/player/${r.profile_id}`)}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 border-b last:border-0 text-left"
                style={{ borderColor: 'rgba(255,255,255,0.06)', background: isMe ? 'rgba(251,191,36,0.12)' : undefined }}>
                <span className="w-7 text-center font-black text-sm shrink-0">{MEDALS[i] ?? `${i + 1}`}</span>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className={`flex-1 text-sm font-bold truncate ${isMe ? 'text-yellow-300' : ''}`}>{r.username}{isMe ? ' (you)' : ''}</span>
                <span className="text-yellow-300 font-black text-sm shrink-0">{r.wins} <span className="text-white/40 text-[10px] font-bold">WINS</span></span>
              </button>
            )
          })}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-orange-700/60 text-white text-sm font-bold px-4 py-2.5 rounded-full shadow-2xl whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}

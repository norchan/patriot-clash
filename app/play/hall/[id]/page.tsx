'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Shield, Sword, Trophy } from 'lucide-react'

// GUEST TOWN HALL — a read-only look at a hall for signed-out visitors: who
// holds it, how defended, and its town feed. The exits are the game: "see it
// on the map" drops them into the free guest world centered here; "sign up"
// lets them actually challenge it. Public route (/play(.*)), public API.

interface Hall {
  id: string; city_name: string; county: string | null; state: string
  holder_party: 'democrat' | 'republican' | null; holder_username: string | null
  holder_message: string | null; defense_points: number; held_since: string | null
  total_captures: number; radius_miles: number; latitude: number; longitude: number
}
interface Post {
  id: string; content: string | null; image_url: string | null; image_url2: string | null
  score: number; comment_count: number; created_at: string
  party: string | null; username: string; avatar_url: string | null
}

const partyColor = (p: string | null) => p === 'democrat' ? '#2563eb' : p === 'republican' ? '#dc2626' : '#6b7280'
const partyLabel = (p: string | null) => p === 'democrat' ? 'Democrat' : p === 'republican' ? 'Republican' : 'Unclaimed'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function GuestHallPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [hall, setHall] = useState<Hall | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!params?.id) return
    fetch(`/api/public/hall/${params.id}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { setHall(d.hall); setPosts(d.posts ?? []) })
      .catch(() => setGone(true))
  }, [params?.id])

  if (gone) return (
    <div className="fixed inset-0 bg-gray-950 text-gray-200 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl">🏚️</p>
      <p className="text-white font-black text-xl">This town hall isn&apos;t here</p>
      <button onClick={() => router.push('/play')} className="mt-2 px-6 py-3 rounded-2xl font-black text-white shadow-xl"
        style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>← Back to the map</button>
    </div>
  )
  if (!hall) return <div className="fixed inset-0 bg-gray-950 flex items-center justify-center text-gray-500 text-sm">Loading…</div>

  const color = partyColor(hall.holder_party)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-28">
      <div className="max-w-md mx-auto px-4 py-5">
        {/* header */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/play')} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
          <span className="text-gray-500 text-xs font-black">👻 GUEST VIEW</span>
        </div>

        {/* hall card */}
        <div className="mt-4 rounded-2xl p-5 border" style={{ borderColor: `${color}55`, background: `${color}12` }}>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/halls/hall_intact.webp" alt="" className="w-16 h-auto"
              style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
            <div className="min-w-0">
              <h1 className="text-white font-black text-xl truncate">🏛️ {hall.city_name}</h1>
              <p className="text-gray-400 text-xs">{hall.county ? `${hall.county}, ` : ''}{hall.state}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            <span className="text-sm font-bold" style={{ color }}>{partyLabel(hall.holder_party)}-held</span>
            {hall.holder_username && <span className="text-gray-400 text-sm">· {hall.holder_username}</span>}
          </div>
          {hall.holder_message && (
            <p className="mt-2 text-gray-300 text-sm italic">“{hall.holder_message}”</p>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="bg-black/30 rounded-xl py-2.5">
              <Shield size={16} className="mx-auto text-sky-400" />
              <p className="text-white font-black text-sm mt-1">{hall.defense_points.toLocaleString()}</p>
              <p className="text-gray-500 text-[10px]">defense</p>
            </div>
            <div className="bg-black/30 rounded-xl py-2.5">
              <Trophy size={16} className="mx-auto text-amber-400" />
              <p className="text-white font-black text-sm mt-1">{hall.total_captures}</p>
              <p className="text-gray-500 text-[10px]">captures</p>
            </div>
            <div className="bg-black/30 rounded-xl py-2.5">
              <Sword size={16} className="mx-auto text-red-400" />
              <p className="text-white font-black text-sm mt-1">{hall.radius_miles}mi</p>
              <p className="text-gray-500 text-[10px]">zone</p>
            </div>
          </div>
        </div>

        {/* CTAs */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => router.push(`/play?flat=${hall.latitude}&flng=${hall.longitude}`)}
            className="py-3 rounded-2xl font-black text-sm bg-white/5 border border-white/10 text-white active:scale-95">
            🗺️ See it on the map
          </button>
          <button onClick={() => router.push('/sign-up')}
            className="py-3 rounded-2xl font-black text-white text-sm shadow-xl active:scale-95"
            style={{ background: 'linear-gradient(90deg,#2563eb,#7c3aed,#dc2626)' }}>
            ⚔️ Sign up to take it
          </button>
        </div>

        {/* town feed */}
        <h2 className="mt-6 mb-2 px-1 text-white font-black text-sm">🗣️ Town feed</h2>
        {posts.length === 0 ? (
          <p className="text-gray-600 text-sm px-1">Quiet in town right now.</p>
        ) : (
          <div className="space-y-2">
            {posts.map(p => (
              <div key={p.id} className="bg-gray-900 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  {p.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border" style={{ borderColor: partyColor(p.party) }} />
                    : <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ background: partyColor(p.party) }}>{p.username[0]?.toUpperCase() ?? 'P'}</span>}
                  <span className="text-gray-300 text-xs font-bold">{p.username}</span>
                  <span className="text-gray-600 text-[11px]">· {timeAgo(p.created_at)}</span>
                </div>
                {p.content && <p className="mt-2 text-gray-100 text-sm whitespace-pre-wrap break-words">{p.content}</p>}
                {p.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" className="mt-2 w-full rounded-xl border border-gray-800 max-h-80 object-cover" loading="lazy" />
                )}
                <div className="mt-2 text-gray-600 text-[11px] font-bold">▲ {p.score} · 💬 {p.comment_count}</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => router.push('/sign-up')}
          className="mt-5 w-full py-3.5 rounded-2xl font-black text-white shadow-xl active:scale-95"
          style={{ background: 'linear-gradient(90deg,#2563eb,#7c3aed,#dc2626)' }}>
          ⚔️ Sign up free — join the fight for {hall.city_name}
        </button>
      </div>
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Swords, Check } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { FIGHTERS } from '@/components/PvpArena3D'
import { HEADS, headImage } from '@/config/heads'

// ── My Fighter ───────────────────────────────────────────────────────────────
// Pick a BODY (the six 3D boxers, party blue/red kit applied automatically)
// and a HEAD (caricature catalog — every head works on every body). That's it:
// no skin/hair/build matrices. New heads are catalog-only drop-ins
// (config/heads.ts + public/heads/<id>.png).

const PvpArena3D = dynamic(() => import('@/components/PvpArena3D'), { ssr: false })
const BODY_KEY = 'pvp_fighter'
const HEAD_KEY = 'pvp_head'

export default function MyFighterPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const isDem = profile?.party === 'democrat'
  const partySuffix = isDem ? 'dem' : 'rep'

  const [body, setBody] = useState('fighter1')
  const [head, setHead] = useState<string | null>(null) // null = the body's own head
  const [attackKey, setAttackKey] = useState(0)
  const [saved, setSaved] = useState(false)
  const [loadedProfile, setLoadedProfile] = useState(false)

  // restore last saved choice (localStorage first, then the profile wins once)
  useEffect(() => {
    try {
      const b = localStorage.getItem(BODY_KEY); if (b && FIGHTERS.some(f => f.id === b)) setBody(b)
      const h = localStorage.getItem(HEAD_KEY); if (h && HEADS.some(x => x.id === h)) setHead(h)
    } catch {}
  }, [])
  useEffect(() => {
    if (loadedProfile || !profile) return
    const p = profile as any
    if (p.pvp_fighter && FIGHTERS.some(f => f.id === p.pvp_fighter)) setBody(p.pvp_fighter)
    if (p.head_id && HEADS.some(x => x.id === p.head_id)) setHead(p.head_id)
    setLoadedProfile(true)
  }, [profile, loadedProfile])

  function save(nextBody: string, nextHead: string | null) {
    setBody(nextBody); setHead(nextHead)
    try {
      localStorage.setItem(BODY_KEY, nextBody)
      if (nextHead) localStorage.setItem(HEAD_KEY, nextHead); else localStorage.removeItem(HEAD_KEY)
    } catch {}
    fetch('/api/profile/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pvp_fighter: nextBody, head_id: nextHead }),
    }).catch(() => {})
    setSaved(true); setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-10">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="text-white font-bold text-lg">My Fighter</h1>
        {saved && <span className="ml-auto text-green-400 text-xs font-bold">Saved ✓</span>}
      </div>

      {/* Live 3D preview — the exact fighter opponents will see in PvP */}
      <div className="relative mx-auto" style={{ width: '100%', maxWidth: 480, aspectRatio: '1 / 1' }}>
        <PvpArena3D
          playerPrefix={`${body}_${partySuffix}`}
          playerHeadId={head}
          playerJabRKey={attackKey}
          solo
        />
        <button onClick={() => setAttackKey(k => k + 1)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg">
          <Swords size={14} /> Test Punch
        </button>
      </div>

      {/* ── BODY ── */}
      <div className="px-4 mt-4">
        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">
          Body <span className={`normal-case ${isDem ? 'text-blue-400' : 'text-red-400'}`}>· {isDem ? '🔵 Democrat blue kit' : '🔴 Republican red kit'}</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {FIGHTERS.map(f => (
            <button key={f.id} onClick={() => save(f.id, head)}
              className={`relative rounded-xl overflow-hidden border-2 transition ${body === f.id ? 'border-purple-500' : 'border-gray-800'}`}>
              <img src={`/fighters/${f.id}_${partySuffix}.png`} alt={f.label} className="w-full aspect-[3/4] object-cover bg-gray-900" />
              <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[11px] font-bold py-1 text-center">{f.label}</div>
              {body === f.id && (
                <div className="absolute top-1 right-1 bg-purple-600 rounded-full p-0.5"><Check size={12} className="text-white" /></div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── HEAD ── */}
      <div className="px-4 mt-5">
        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">
          Head <span className="text-gray-600 normal-case">· any head on any body</span>
        </p>
        <div className="grid grid-cols-4 gap-2">
          {/* the body's own head */}
          <button onClick={() => save(body, null)}
            className={`relative rounded-xl overflow-hidden border-2 bg-gray-900 aspect-square flex flex-col items-center justify-center transition ${head === null ? 'border-purple-500' : 'border-gray-800'}`}>
            <span className="text-2xl">🙂</span>
            <span className="text-gray-300 text-[10px] font-bold mt-1">Own head</span>
            {head === null && (
              <div className="absolute top-1 right-1 bg-purple-600 rounded-full p-0.5"><Check size={12} className="text-white" /></div>
            )}
          </button>
          {HEADS.map(h => (
            <button key={h.id} onClick={() => save(body, h.id)}
              className={`relative rounded-xl overflow-hidden border-2 bg-gray-900 aspect-square transition ${head === h.id ? 'border-purple-500' : 'border-gray-800'}`}>
              <img src={headImage(h.id)} alt={h.label} className="w-full h-full object-contain p-1.5" />
              <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[9px] font-bold py-0.5 text-center truncate px-1">{h.label}</div>
              {head === h.id && (
                <div className="absolute top-1 right-1 bg-purple-600 rounded-full p-0.5"><Check size={12} className="text-white" /></div>
              )}
            </button>
          ))}
        </div>
        <p className="text-gray-600 text-xs mt-3">
          Tap a body and a head — it saves instantly and this exact fighter shows up in your next PvP battle.
        </p>
      </div>
    </div>
  )
}

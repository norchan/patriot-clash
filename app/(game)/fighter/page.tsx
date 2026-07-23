'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  return <Suspense fallback={<div className="min-h-screen bg-gray-950" />}><MyFighterInner /></Suspense>
}

function MyFighterInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const welcome = searchParams.get('welcome') === '1' // new-player onboarding step
  const { profile } = useProfile()
  const isDem = profile?.party === 'democrat'
  const partySuffix = isDem ? 'dem' : 'rep'

  const myParty = profile?.party === 'democrat' ? 'democrat' : 'republican'
  const partyHeads = HEADS.filter(h => h.party === myParty)
  const [body, setBody] = useState('fighter1')
  const [head, setHead] = useState<string | null>(null) // null = the body's own head
  const [attackKey, setAttackKey] = useState(0)
  const [saved, setSaved] = useState(false)
  const [loadedProfile, setLoadedProfile] = useState(false)

  // restore last saved choice (localStorage first, then the profile wins once)
  useEffect(() => {
    try {
      const b = localStorage.getItem(BODY_KEY); if (b && FIGHTERS.some(f => f.id === b)) setBody(b)
      const h = localStorage.getItem(HEAD_KEY); if (h) setHead(h) // validated against the party list below
    } catch {}
  }, [])
  useEffect(() => {
    if (loadedProfile || !profile) return
    const p = profile as any
    if (p.pvp_fighter && FIGHTERS.some(f => f.id === p.pvp_fighter)) setBody(p.pvp_fighter)
    const partyList = HEADS.filter(h => h.party === (p.party === 'democrat' ? 'democrat' : 'republican'))
    if (p.head_id && partyList.some(x => x.id === p.head_id)) setHead(p.head_id)
    else setHead(null)
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

  // Onboarding skip: keep the default body + own head and head into the game.
  function skipToGame() {
    save('fighter1', null)
    router.push('/map')
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-28">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        {!welcome && <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>}
        <h1 className="text-white font-bold text-lg">{welcome ? 'Build your fighter' : 'My Fighter'}</h1>
        {saved && <span className="ml-auto text-green-400 text-xs font-bold">Saved ✓</span>}
      </div>

      {welcome && (
        <div className="px-4 pt-3">
          <p className="text-gray-400 text-sm">
            Last step — pick a body and a head for your street fighter. Not sure? <span className="text-white font-bold">Skip</span> it and we&apos;ll give you one; you can change it anytime.
          </p>
        </div>
      )}

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
          Head <span className={`normal-case ${isDem ? 'text-blue-400' : 'text-red-400'}`}>· {isDem ? 'Democrat heads' : 'Republican heads'}</span>
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
          {partyHeads.map(h => (
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

      {/* onboarding: fixed action bar — Skip (default fighter) or enter the game */}
      {welcome && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-4 py-3 flex items-center gap-3 max-w-[520px] mx-auto">
          <button onClick={skipToGame}
            className="px-5 py-3.5 rounded-2xl font-bold text-gray-300 bg-gray-900 border border-gray-700 hover:text-white">
            Skip
          </button>
          <button onClick={() => { save(body, head); router.push('/map') }}
            className="flex-1 py-3.5 rounded-2xl font-black text-lg text-white"
            style={{ background: isDem ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
            Enter the game →
          </button>
        </div>
      )}
    </div>
  )
}

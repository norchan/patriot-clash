'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Swords, Check } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { FIGHTERS } from '@/components/PvpArena3D'
import { winsForLevel } from '@/config/fighters'
import { fighterLevel } from '@/lib/fighter'
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
  // Sprite fighters are party-locked and level-gated (Michael): show only
  // yours, and lock the ones you haven't earned yet.
  // ONE level formula for the whole app — fighterLevel() from lib/fighter.ts.
  // (This page used to roll its own floor(wins/5)+1, which disagreed with the
  // arena and the API. Never reintroduce a second formula.)
  const myWins = (profile as any)?.total_battles_won ?? 0
  const myLevel = fighterLevel(myWins)
  const myFighters = FIGHTERS.filter(f => !f.party || f.party === myParty)
  const [body, setBody] = useState('fighter1')
  const [head, setHead] = useState<string | null>(null) // null = the body's own head
  const [attackKey, setAttackKey] = useState(0)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
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

  // Saves immediately on tap. A rejected save used to be swallowed silently,
  // which made the pick "stick" in the UI then snap back on reload (Michael) —
  // now a failure surfaces and the picker reverts to what the server has.
  async function save(nextBody: string, nextHead: string | null) {
    const prevBody = body, prevHead = head
    setBody(nextBody); setHead(nextHead)
    try {
      localStorage.setItem(BODY_KEY, nextBody)
      if (nextHead) localStorage.setItem(HEAD_KEY, nextHead); else localStorage.removeItem(HEAD_KEY)
    } catch {}
    try {
      const res = await fetch('/api/profile/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pvp_fighter: nextBody, head_id: nextHead }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSaveError(d.error || 'Could not save that fighter')
        setTimeout(() => setSaveError(''), 3000)
        setBody(prevBody); setHead(prevHead)
        try { localStorage.setItem(BODY_KEY, prevBody) } catch {}
        return
      }
    } catch {
      setSaveError('Network error — not saved')
      setTimeout(() => setSaveError(''), 3000)
      setBody(prevBody); setHead(prevHead)
      return
    }
    setSaved(true); setTimeout(() => setSaved(false), 1200)
  }

  // Onboarding skip: keep the default body + own head and head into the game.
  function skipToGame() {
    save('fighter1', null)
    router.push('/map')
  }

  // pb-44 clears BOTH the floating save bar and the fixed bottom nav
  return (
    <div className="min-h-screen bg-gray-950 pb-44">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        {!welcome && <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>}
        <h1 className="text-white font-bold text-lg">{welcome ? 'Build your fighter' : 'My Fighter'}</h1>
        {saved && <span className="ml-auto text-green-400 text-xs font-bold">Saved ✓</span>}
        {saveError && <span className="ml-auto text-red-400 text-xs font-bold">{saveError}</span>}
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
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">
            Body <span className={`normal-case ${isDem ? 'text-blue-400' : 'text-red-400'}`}>· {isDem ? '🔵 Democrat blue kit' : '🔴 Republican red kit'}</span>
          </p>
          {/* level + the next thing to chase */}
          {(() => {
            const nextLocked = myFighters
              .filter(f => (f.minLevel ?? 1) > myLevel)
              .sort((a, b) => (a.minLevel ?? 1) - (b.minLevel ?? 1))[0]
            return (
              <p className="text-[11px] font-bold text-gray-400 shrink-0">
                <span className="text-amber-300">LVL {myLevel}</span>
                {nextLocked && (
                  <span className="text-gray-500"> · {nextLocked.label} at {nextLocked.minLevel}
                    {' '}({Math.max(0, winsForLevel(nextLocked.minLevel!) - myWins)} more wins)
                  </span>
                )}
              </p>
            )
          })()}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {myFighters.map(f => {
            const need = f.minLevel ?? 1
            const earned = myLevel >= need
            // GRANDFATHERED: a fighter saved during the unlocked playtest stays
            // usable and selected even if the player is now under its level —
            // we only block NEW saves of unearned fighters (Michael 2026-07-28).
            const grandfathered = !earned && body === f.id
            const locked = !earned && !grandfathered
            return (
            <button key={f.id} disabled={locked}
              onClick={() => { if (!locked) save(f.id, f.ownHead ? null : head) }}
              title={locked ? `Unlocks at level ${need} (${winsForLevel(need)} wins)` : f.label}
              className={`relative rounded-xl overflow-hidden border-2 transition ${body === f.id ? 'border-purple-500' : 'border-gray-800'} ${locked ? 'opacity-60 cursor-not-allowed' : ''}`}>
              <img src={f.thumb ?? `/fighters/${f.id}_${partySuffix}.png`} alt={f.label}
                className={`w-full aspect-[3/4] object-cover bg-gray-900 ${locked ? 'grayscale' : ''}`} />
              <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[11px] font-bold py-1 text-center">{f.label}</div>
              {locked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55">
                  <span className="text-xl">🔒</span>
                  <span className="text-white text-[10px] font-black mt-0.5">LEVEL {need}</span>
                  <span className="text-gray-300 text-[9px] font-bold">{winsForLevel(need)} wins</span>
                </div>
              )}
              {grandfathered && (
                <div className="absolute top-1 left-1 bg-amber-600/90 rounded px-1 py-px">
                  <span className="text-white text-[8px] font-black">KEPT</span>
                </div>
              )}
              {body === f.id && (
                <div className="absolute top-1 right-1 bg-purple-600 rounded-full p-0.5"><Check size={12} className="text-white" /></div>
              )}
            </button>
            )
          })}
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

      {/* Persistent SAVE bar (Michael 2026-07-28): choices already save on tap,
          but the confirmation was easy to miss and the old bar sat UNDER the
          fixed bottom nav (bottom-0 vs the nav's z-[90]). This floats just
          above the nav so you can save/confirm from anywhere on the page. */}
      {!welcome && (
        <div className="fixed bottom-20 inset-x-0 z-[95] px-4 max-w-[520px] mx-auto">
          <button onClick={() => save(body, head)}
            className="w-full py-3.5 rounded-2xl font-black text-white shadow-2xl active:scale-[0.98] transition flex items-center justify-center gap-2"
            style={{ background: saveError ? 'linear-gradient(135deg,#dc2626,#b91c1c)'
              : saved ? 'linear-gradient(135deg,#16a34a,#15803d)'
              : isDem ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
            {saveError ? `⚠ ${saveError}` : saved ? 'Saved ✓' : 'Save Fighter'}
          </button>
        </div>
      )}

      {/* onboarding: fixed action bar — Skip (default fighter) or enter the game */}
      {welcome && (
        <div className="fixed bottom-20 inset-x-0 z-[95] bg-gray-950/95 backdrop-blur border-t border-gray-800 px-4 py-3 flex items-center gap-3 max-w-[520px] mx-auto">
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

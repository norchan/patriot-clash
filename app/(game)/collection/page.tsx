'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { ArrowLeft } from 'lucide-react'
import GpkCard from '@/components/GpkCard'

interface CapturedCharacter {
  id: string
  enemy_id: string
  enemy_name: string
  enemy_tier: string
  enemy_image: string
  enemy_party: string
  captured_at: string
}

import { republicanEnemies, democratEnemies } from '@/config/enemies'

// Single source of truth — a hardcoded copy of this list once drifted
const ALL_ENEMIES = [...republicanEnemies, ...democratEnemies]

const partyLabel = (party?: string | null) => party === 'democrat' ? 'Republican' : 'Democrat'

const SELL_PRICES: Record<string, number> = { common: 10, rare: 40, legendary: 250 }

export default function CollectionPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [captured, setCaptured] = useState<CapturedCharacter[]>([])
  const [loading, setLoading] = useState(true)
  const [selling, setSelling] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    fetch('/api/collection')
      .then(r => r.json())
      .then(data => { setCaptured(data.collection || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const capturedIds = new Set(captured.map(c => c.enemy_id))

  // You only ever battle (and catch) the OPPOSING party's sprites — a
  // Republican will never meet The Don, so their roster shouldn't show him.
  // Characters owned from outside the roster (old rules) still render below
  // so they stay sellable.
  const roster = profile?.party === 'democrat' ? republicanEnemies : democratEnemies
  const rosterIds = new Set(roster.map(e => e.id))
  const extras = ALL_ENEMIES.filter(e => !rosterIds.has(e.id) && capturedIds.has(e.id))
  const shown = [...roster, ...extras]
  const rosterCaught = roster.filter(e => capturedIds.has(e.id)).length

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Sells one SURPLUS copy — the server keeps the first-ever catch forever
  async function sellOne(enemyId: string, name: string) {
    if (selling) return
    const copies = captured.filter(c => c.enemy_id === enemyId)
    if (copies.length < 2) return // first copy is a keeper
    setSelling(true)
    try {
      const res = await fetch('/api/collection/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enemy_id: enemyId }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(`❌ ${data.error || 'Sale failed'}`); return }
      // server sells the NEWEST copy — mirror that locally
      const newest = [...copies].sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0]
      setCaptured(prev => prev.filter(c => c.id !== newest.id))
      refetch()
      showToast(`💰 Sold ${name} for ${data.fp_earned} FP!`)
    } catch { showToast('❌ Sale failed') }
    finally { setSelling(false) }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-3 hover:text-white">
          <ArrowLeft size={16} /><span className="text-sm">Back</span>
        </button>
        <h1 className="text-white font-bold text-2xl">Collection</h1>
        <p className="text-gray-500 text-sm mt-1">
          {partyLabel(profile?.party)} targets: {rosterCaught} / {roster.length} caught · {captured.length} total owned
        </p>
        {/* Progress bar */}
        <div className="h-2 bg-gray-800 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-yellow-500 transition-all"
            style={{ width: `${(rosterCaught / Math.max(1, roster.length)) * 100}%` }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-400">Loading collection...</p>
        </div>
      ) : (
        // GPK-style trading cards (shared GpkCard) — tapping a captured card
        // opens that character's public wiki page
        <div className="px-4 mt-4 grid grid-cols-2 gap-4">
          {shown.map(e => {
            const isCaptured = capturedIds.has(e.id)
            const copies = captured.filter(c => c.enemy_id === e.id).length
            const cardNo = ALL_ENEMIES.findIndex(x => x.id === e.id) + 1

            return (
              <div key={e.id} className="relative">
                <button
                  onClick={() => isCaptured && router.push(`/explore/characters/${e.id}`)}
                  className={`block w-full text-left ${isCaptured ? 'active:scale-[0.98] transition cursor-pointer' : 'cursor-default'}`}
                  aria-label={isCaptured ? `${e.name} — open wiki` : 'Uncaptured character'}
                >
                  <GpkCard name={e.name} image={e.image} tier={e.tier} cardNo={cardNo}
                    copies={copies} captured={isCaptured} />
                </button>

                {/* sell-extra button rides below the card */}
                {isCaptured && copies > 1 ? (
                  <button
                    onClick={() => sellOne(e.id, e.name)}
                    disabled={selling}
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full text-[10px] font-black bg-amber-500 text-black shadow-lg active:scale-95 transition disabled:opacity-50 whitespace-nowrap"
                  >
                    💰 Sell extra · {SELL_PRICES[e.tier] ?? 10} FP
                  </button>
                ) : isCaptured ? (
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full text-[10px] font-bold bg-gray-800 text-gray-500 whitespace-nowrap border border-gray-700">
                    🔒 Keeper
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
        </div>
      )}
    </div>
  )
}
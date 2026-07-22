'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { ArrowLeft } from 'lucide-react'

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
  const tierColor = (tier: string) =>
    tier === 'legendary' ? '#f59e0b' : tier === 'rare' ? '#8b5cf6' : '#6b7280'

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
        // GPK-style trading cards: classic blue border, white inner frame,
        // full-bleed art, skewed yellow name banner
        <div className="px-4 mt-4 grid grid-cols-2 gap-4">
          {shown.map((e, idx) => {
            const isCaptured = capturedIds.has(e.id)
            const copies = captured.filter(c => c.enemy_id === e.id).length
            const color = tierColor(e.tier)

            return (
              <div key={e.id} className="relative" style={{ aspectRatio: '2.5 / 3.5' }}>
                {/* outer card: classic GPK blue border w/ rounded corners */}
                <div className="absolute inset-0 rounded-xl overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
                  style={{
                    background: isCaptured ? '#1c63c7' : '#2a3648',
                    padding: 7,
                  }}>
                  {/* white inner frame */}
                  <div className="w-full h-full rounded-lg overflow-hidden relative"
                    style={{ background: '#f3ead1', border: '3px solid #fdf6e3' }}>
                    {/* art area: comic starburst */}
                    <div className="absolute inset-0"
                      style={{
                        background: isCaptured
                          ? `repeating-conic-gradient(from 0deg at 50% 42%, ${color}26 0deg 9deg, #f3ead1 9deg 18deg)`
                          : 'repeating-conic-gradient(from 0deg at 50% 42%, #94a3b81f 0deg 9deg, #22293a 9deg 18deg)',
                      }} />
                    <div className="absolute inset-0 flex items-end justify-center pb-8">
                      <img
                        src={e.image}
                        alt={e.name}
                        className="h-[86%] object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.45)]"
                        style={{ filter: isCaptured ? 'none' : 'grayscale(1) brightness(0.3)' }}
                      />
                    </div>
                    {!isCaptured && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-5xl drop-shadow-[0_3px_4px_rgba(0,0,0,0.8)]">❓</span>
                      </div>
                    )}

                    {/* card number pennant — top right, like the GPK '1a' */}
                    <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-sm text-[10px] font-black"
                      style={{ background: '#d92c2c', color: '#fff', transform: 'rotate(3deg)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                      {String(idx + 1)}{isCaptured ? 'a' : '?'}
                    </div>

                    {/* ×N sticker — round, like a price sticker */}
                    {isCaptured && copies > 1 && (
                      <div className="absolute top-1.5 left-1.5 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black"
                        style={{ background: '#ffd400', color: '#111', border: '2px solid #fff', transform: 'rotate(-8deg)', boxShadow: '0 2px 4px rgba(0,0,0,0.45)' }}>
                        ×{copies}
                      </div>
                    )}
                    {/* tier star strip */}
                    {isCaptured && (
                      <div className="absolute top-10 left-1.5 text-[10px]" style={{ transform: 'rotate(-8deg)' }}>
                        {e.tier === 'legendary' ? '⭐⭐⭐' : e.tier === 'rare' ? '⭐⭐' : '⭐'}
                      </div>
                    )}

                    {/* skewed yellow NAME banner — the GPK signature */}
                    <div className="absolute bottom-1.5 left-0 right-0 flex justify-center pointer-events-none">
                      <div className="px-2.5 py-1 max-w-[94%]"
                        style={{
                          background: isCaptured ? '#ffd400' : '#6b7280',
                          transform: 'rotate(-3deg) skewX(-6deg)',
                          border: '2px solid #111',
                          boxShadow: '2px 2px 0 rgba(0,0,0,0.55)',
                        }}>
                        <span className="block text-[12px] leading-tight font-black uppercase tracking-tight truncate"
                          style={{ color: isCaptured ? '#c81e1e' : '#1f2937', transform: 'skewX(6deg)', textShadow: isCaptured ? '1px 1px 0 #fff' : 'none', fontFamily: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' }}>
                          {isCaptured ? e.name : '???'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

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
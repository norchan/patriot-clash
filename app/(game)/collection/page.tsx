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

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Sells the OLDEST copy of a character (keeps the newest capture date)
  async function sellOne(enemyId: string, name: string, tier: string) {
    if (selling) return
    const copies = captured.filter(c => c.enemy_id === enemyId)
    if (copies.length === 0) return
    const target = [...copies].sort((a, b) => a.captured_at.localeCompare(b.captured_at))[0]
    setSelling(true)
    try {
      const res = await fetch('/api/collection/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captured_id: target.id }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(`❌ ${data.error || 'Sale failed'}`); return }
      setCaptured(prev => prev.filter(c => c.id !== target.id))
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
          {capturedIds.size} / {ALL_ENEMIES.length} unique · {captured.length} total owned
        </p>
        {/* Progress bar */}
        <div className="h-2 bg-gray-800 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-yellow-500 transition-all"
            style={{ width: `${(capturedIds.size / ALL_ENEMIES.length) * 100}%` }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-400">Loading collection...</p>
        </div>
      ) : (
        <div className="px-4 mt-4 grid grid-cols-2 gap-3">
          {ALL_ENEMIES.map(e => {
            const isCaptured = capturedIds.has(e.id)
            const captureData = captured.find(c => c.enemy_id === e.id)
            const copies = captured.filter(c => c.enemy_id === e.id).length
            const color = tierColor(e.tier)

            return (
              <div
                key={e.id}
                className="rounded-2xl overflow-hidden border relative"
                style={{
                  borderColor: isCaptured ? color : '#1f2937',
                  background: isCaptured ? `${color}11` : '#0f172a',
                }}
              >
                {/* Image — transparent cutout on a tier-tinted spotlight */}
                <div className="relative h-32 flex items-end justify-center overflow-hidden"
                  style={{
                    background: isCaptured
                      ? `radial-gradient(circle at 50% 28%, ${color}2e 0%, ${color}0a 45%, #0b1220 100%)`
                      : 'radial-gradient(circle at 50% 30%, #1f293766 0%, #0b1220 100%)',
                  }}>
                  <img
                    src={e.image}
                    alt={e.name}
                    className="h-[88%] object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.6)]"
                    style={{ filter: isCaptured ? 'none' : 'grayscale(1) brightness(0.25)' }}
                  />
                  {/* ground glow */}
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-20 h-2.5 rounded-full pointer-events-none"
                    style={{ background: `radial-gradient(ellipse, ${isCaptured ? color + '55' : '#00000066'}, transparent 70%)`, filter: 'blur(2px)' }} />
                  {!isCaptured && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-4xl">❓</span>
                    </div>
                  )}
                  {isCaptured && (
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      {copies > 1 && (
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-white/90 text-black">
                          ×{copies}
                        </span>
                      )}
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `${color}33`, color }}
                      >
                        {e.tier === 'legendary' ? '⭐' : e.tier === 'rare' ? '💜' : '•'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-2">
                  <div className="text-white text-xs font-bold truncate">
                    {isCaptured ? e.name : '???'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: isCaptured ? color : '#374151' }}>
                    {isCaptured ? e.tier : 'Not captured'}
                  </div>
                  {isCaptured && captureData && (
                    <div className="text-gray-600 text-xs mt-0.5">
                      {new Date(captureData.captured_at).toLocaleDateString()}
                    </div>
                  )}
                  {isCaptured && (
                    <button
                      onClick={() => sellOne(e.id, e.name, e.tier)}
                      disabled={selling}
                      className="w-full mt-1.5 py-1.5 rounded-lg text-[11px] font-bold bg-gray-800 text-amber-400 hover:bg-gray-700 transition active:scale-95 disabled:opacity-50"
                    >
                      💰 Sell {copies > 1 ? 'one ' : ''}· {SELL_PRICES[e.tier] ?? 10} FP
                    </button>
                  )}
                </div>
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
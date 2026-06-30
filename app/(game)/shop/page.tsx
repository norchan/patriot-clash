'use client'
import { useState } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { Zap } from 'lucide-react'

const PACKS = [
  { id: 'fp_100',   name: 'Starter Pack', fp: 100,   bonus: 0,     price: '$0.99',  emoji: '⚡',   featured: false },
  { id: 'fp_600',   name: 'Value Pack',   fp: 500,   bonus: 100,   price: '$4.99',  emoji: '⚡⚡', featured: true  },
  { id: 'fp_1400',  name: 'Power Pack',   fp: 1000,  bonus: 400,   price: '$9.99',  emoji: '🔋',   featured: false },
  { id: 'fp_3200',  name: 'Elite Pack',   fp: 2000,  bonus: 1200,  price: '$19.99', emoji: '🔥',   featured: false },
  { id: 'fp_32000', name: 'Super Pack',   fp: 20000, bonus: 12000, price: '$99.99', emoji: '👑',   featured: false },
]

const DEFENSE_SHOP = [
  { id: 'iron_firewall',   name: 'Iron Firewall',   desc: '+20% passive defense, 24h',         cost: 200,  emoji: '🛡️' },
  { id: 'sandbag_wall',    name: 'Sandbag Wall',    desc: '+500 defense points instantly',      cost: 350,  emoji: '🪨' },
  { id: 'decoy_gym',       name: 'Decoy Gym',       desc: 'Absorbs one full attack completely', cost: 500,  emoji: '🎭' },
  { id: 'rally_beacon',    name: 'Rally Beacon',    desc: 'Push-notify allies when attacked',  cost: 150,  emoji: '📡' },
  { id: 'bunker_protocol', name: 'Bunker Protocol', desc: '6-hour full attack immunity',       cost: 1000, emoji: '🏰' },
]

export default function ShopPage() {
  const { profile, refetch } = useProfile()
  const [loading, setLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function buyPack(packId: string) {
    setLoading(packId)
    try {
      const res = await fetch('/api/shop/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: packId }),
      })
      const data = await res.json()
      if (data.checkout_url) {
        window.location.href = data.checkout_url
      } else {
        showToast('❌ Failed to start checkout')
      }
    } catch {
      showToast('❌ Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b border-gray-800">
        <h1 className="text-white font-bold text-2xl">Shop</h1>
        <div className="mt-2 bg-gray-900 rounded-xl px-4 py-3 flex items-center gap-2 w-fit">
          <Zap size={16} className="text-yellow-400" />
          <span className="text-yellow-400 font-bold">{profile?.fp_balance?.toLocaleString() || 0} FP</span>
          <span className="text-gray-500 text-sm">available</span>
        </div>
      </div>

      {/* FP Packs */}
      <div className="px-4 mt-5">
        <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Buy Fighting Points</h2>
        <div className="grid grid-cols-2 gap-3">
          {PACKS.map(pack => (
            <button
              key={pack.id}
              onClick={() => buyPack(pack.id)}
              disabled={!!loading}
              className={`relative p-4 rounded-2xl border text-center transition-all active:scale-95 ${
                pack.featured
                  ? 'border-yellow-500 bg-yellow-950/30'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700'
              } disabled:opacity-50`}
            >
              {pack.featured && (
                <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">
                  BEST VALUE
                </div>
              )}
              <div className="text-3xl mb-2">{pack.emoji}</div>
              <div className="text-white font-bold text-sm">{pack.name}</div>
              <div className="text-yellow-400 font-bold text-lg mt-1">
                {(pack.fp + pack.bonus).toLocaleString()} FP
              </div>
              {pack.bonus > 0 && (
                <div className="text-green-400 text-xs">+{pack.bonus.toLocaleString()} bonus!</div>
              )}
              <div className="text-gray-400 text-sm mt-2">{pack.price}</div>
              {loading === pack.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl">
                  <div className="text-white text-xs">⏳</div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Defense Items */}
      <div className="px-4 mt-6">
        <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Defense Upgrades</h2>
        <p className="text-gray-600 text-xs mb-3">Buy from inside a Town Hall you control</p>
        <div className="space-y-3">
          {DEFENSE_SHOP.map(item => {
            const canAfford = (profile?.fp_balance || 0) >= item.cost
            return (
              <div key={item.id} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="text-2xl w-10 text-center">{item.emoji}</div>
                <div className="flex-1">
                  <div className="text-white text-sm font-medium">{item.name}</div>
                  <div className="text-gray-500 text-xs">{item.desc}</div>
                </div>
                <div className={`text-sm font-bold ${canAfford ? 'text-yellow-400' : 'text-gray-600'}`}>
                  {item.cost} FP
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Free FP tips */}
      <div className="mx-4 mt-6 bg-gray-900 rounded-2xl p-4">
        <h3 className="text-white font-semibold text-sm mb-3">🆓 Earn Free FP</h3>
        <div className="space-y-2">
          {[
            { emoji: '👟', text: '10 FP per 500 steps walked' },
            { emoji: '⚔️', text: 'Win battles for FP rewards' },
            { emoji: '🏛️', text: '+50 FP for capturing a Town Hall' },
            { emoji: '📅', text: '+10 FP daily login bonus' },
          ].map(tip => (
            <div key={tip.text} className="flex items-center gap-3">
              <span className="text-lg">{tip.emoji}</span>
              <span className="text-gray-400 text-sm">{tip.text}</span>
            </div>
          ))}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
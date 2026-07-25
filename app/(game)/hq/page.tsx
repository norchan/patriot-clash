'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

// 🏠 YOUR HOUSE / CAMPAIGN HQ (Michael 2026-07-25): the profile's House icon
// lands here. Today it hosts the Campaign HQ Print Shop (moved off the
// profile); this page will grow — upgrades, staff, a real base — over time.
// Desktop rails come from the game layout like every page.

interface Farm { ready: number; next_in_secs: number | null; rate_hours: number; cap: number }

export default function HqPage() {
  const router = useRouter()
  const [farm, setFarm] = useState<Farm | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const load = () => fetch('/api/farm').then(r => r.json()).then(d => setFarm(d)).catch(() => {})
  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [])

  async function claim() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/farm', { method: 'POST' })
      const d = await res.json()
      if (res.ok && d.claimed > 0) {
        setToast(`🧨 +${d.claimed} firecracker${d.claimed === 1 ? '' : 's'} to your bag!`)
        setTimeout(() => setToast(''), 3000)
      }
      load()
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-28">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="text-white font-black text-lg">🏠 Campaign HQ</h1>
        </div>
        <p className="text-gray-500 text-xs mt-1.5">Your base of operations — more rooms open over time.</p>

        {/* Print Shop — slowly prints siege firecrackers; claim adds to bag */}
        <div className="mt-4 bg-gray-900 rounded-2xl border border-gray-800 p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-amber-500/15 flex items-center justify-center text-xl">🖨️</div>
          <div className="flex-1 min-w-0">
            <p className="text-gray-500 text-xs">Print Shop</p>
            {farm === null ? (
              <p className="text-gray-500 text-sm font-bold">Loading…</p>
            ) : farm.ready > 0 ? (
              <p className="text-amber-300 font-black text-lg leading-tight">🧨 {farm.ready} firecracker{farm.ready === 1 ? '' : 's'} ready</p>
            ) : (
              <p className="text-gray-400 text-sm font-bold">Printing… next 🧨 in {Math.max(1, Math.ceil((farm.next_in_secs ?? 0) / 60))} min</p>
            )}
            <p className="text-gray-600 text-[10px]">1 every {farm?.rate_hours ?? 2}h · holds {farm?.cap ?? 10}</p>
          </div>
          <button onClick={claim} disabled={!farm || farm.ready <= 0 || busy}
            className="px-4 py-2.5 rounded-xl font-black text-sm text-black transition active:scale-95 disabled:opacity-35"
            style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }}>
            {busy ? '…' : 'CLAIM'}
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-gray-800 bg-gray-900/50 px-4 py-5 text-center">
          <p className="text-gray-500 text-sm font-bold">More rooms under construction 🏗️</p>
          <p className="text-gray-600 text-xs mt-1">Upgrades, staff and headquarters perks are coming.</p>
        </div>

        {toast && (
          <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
            <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
          </div>
        )}
      </div>
    </div>
  )
}

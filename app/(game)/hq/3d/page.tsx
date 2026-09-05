'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import type { Base3DBuilding } from '@/components/Base3D'

// 3D BASE PREVIEW — your real yard, in 3D. Same buildings, same data
// (/api/house), rendered as a true 3D lot you can orbit. Separate route from
// the live 2D base so it can iterate freely. WebGL is client-only.
const Base3D = dynamic(() => import('@/components/Base3D'), { ssr: false })

interface House {
  hq_level: number
  print_shop_pad?: number
  buildings: Array<{ pad: number; type: string; level: number; facing?: number; damaged_until?: string | null }>
}

export default function Base3DPage() {
  const router = useRouter()
  const [house, setHouse] = useState<House | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    fetch('/api/house').then(r => r.json()).then(setHouse).catch(() => setErr(true))
  }, [])

  const now = Date.now()
  const buildings: Base3DBuilding[] = (house?.buildings ?? []).map(b => ({
    pad: b.pad, type: b.type, level: b.level, facing: b.facing,
    damaged: !!b.damaged_until && +new Date(b.damaged_until) > now,
  }))

  return (
    <div className="fixed inset-0 z-[60] bg-[#0b1310] text-gray-200 select-none" style={{ bottom: '4.5rem' }}>
      {house ? (
        <Base3D buildings={buildings} hqLevel={house.hq_level ?? 1} printShopPad={house.print_shop_pad ?? 45} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          {err ? 'Could not load your base.' : 'Building your base in 3D…'}
        </div>
      )}

      {/* chrome */}
      <div className="absolute top-3 left-3 z-[70] flex items-center gap-2">
        <button onClick={() => router.push('/hq')} className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center text-gray-200"><ArrowLeft size={17} /></button>
        <span className="px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur text-amber-300 font-black text-xs">🧊 3D PREVIEW</span>
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[70] px-3 py-1.5 rounded-full bg-black/50 backdrop-blur text-gray-400 text-[11px] font-bold whitespace-nowrap">
        drag to orbit · pinch/scroll to zoom
      </div>
    </div>
  )
}

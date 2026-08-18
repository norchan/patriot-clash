'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { GRID, HQ_PAD, PRINT_SHOP_PAD, hqImage, safeImage, barracksImage, solarImage, turretImage } from '@/config/house'
import IsoYard, { IsoCellSpec, IsoFenceLinks, fenceAdjacency } from '@/components/IsoYard'

// 🏡 VISIT A BASE (R3) — the public landing behind the share poster's link.
// Read-only: the same IsoYard stage as home/raid, zero onTap handlers, no
// build/upgrade/train surface. Works signed-out (route + API are public);
// the CTAs funnel visitors into the game.

interface VisitBase {
  baseLevel: number
  padsOpen: number
  print_shop_pad?: number
  buildings: Array<{ pad: number; type: string; level: number; facing?: number; damaged?: boolean }>
}
interface Visit {
  username: string; party: string; level: number
  trophies: number; defense: number; base: VisitBase
}

const SPRITES: Record<string, { img: (level: number) => string; w: number }> = {
  fence: { img: () => '/house/fence2.webp', w: 118 },
  media_tower: { img: () => '/house/media_tower.webp', w: 126 },
  safe: { img: l => safeImage(l), w: 96 },
  barracks: { img: l => barracksImage(l), w: 150 },
  solar: { img: l => solarImage(l), w: 134 },
  doberman: { img: () => '/house/doberman.webp', w: 104 },
  turret: { img: l => turretImage(l), w: 118 },
  decor: { img: () => '/house/decor_flag.webp', w: 84 },
}

export default function VisitBasePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!params?.id) return
    fetch(`/api/public/base/${params.id}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setVisit)
      .catch(() => setGone(true))
  }, [params?.id])

  if (gone) return (
    <div className="fixed inset-0 bg-[#0d1512] text-gray-200 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl">🏚️</p>
      <p className="text-white font-black text-xl">This base doesn&apos;t exist</p>
      <p className="text-gray-500 text-sm">The link may be old, or the owner packed up and left town.</p>
      <button onClick={() => router.push('/')} className="mt-2 px-6 py-3 rounded-2xl font-black text-white shadow-xl"
        style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
        ⚔️ Play PoliticsGo
      </button>
    </div>
  )

  const tint = visit?.party === 'republican' ? '#dc2626' : '#2563eb'
  const cells: IsoCellSpec[] = []
  const fencePads = new Set<number>()
  if (visit) {
    const psPad = visit.base.print_shop_pad ?? PRINT_SHOP_PAD
    for (const b of visit.base.buildings) {
      if (b.type === 'fence' && !b.damaged) fencePads.add(b.pad)
    }
    const linked = fenceAdjacency(fencePads).linked
    const onPad = new Map(visit.base.buildings.map(b => [b.pad, b]))
    for (let pad = 0; pad < GRID * GRID; pad++) {
      if (pad === HQ_PAD) { cells.push({ pad, img: hqImage(visit.base.baseLevel), imgW: 198 }); continue }
      if (pad === psPad) { cells.push({ pad, img: '/house/print_shop.webp', imgW: 128 }); continue }
      const b = onPad.get(pad)
      if (!b) continue // visitors get a clean lawn — no tappable plot diamonds
      const sp = SPRITES[b.type]
      const isFence = b.type === 'fence'
      cells.push({
        pad,
        img: isFence ? (linked.has(pad) ? '/house/fence_post2.webp' : '/house/fence2.webp') : sp?.img(b.level),
        imgW: isFence ? (linked.has(pad) ? 13 : 76) : sp?.w,
        mirror: ((b.facing ?? 0) % 2) === 1,
        dead: !!b.damaged,
        overlay: b.damaged && !isFence ? '/house/fx/scorch.webp' : undefined,
        idle: b.type === 'doberman' ? 'dog' : undefined,
      })
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#0d1512] text-gray-200 select-none">
      <div className="absolute inset-0">
        <IsoYard cells={cells} bg="/house/yard_bg2.webp" idleFx={[]}>
          <IsoFenceLinks fencePads={fencePads} />
        </IsoYard>
      </div>

      {/* visitor chrome: whose lawn this is + the way into the game */}
      <div className="absolute top-3 left-3 z-[70]">
        <button onClick={() => router.push('/')} className="w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center text-gray-200"><ArrowLeft size={17} /></button>
      </div>
      {visit && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-4 py-2 rounded-2xl bg-black/60 backdrop-blur border border-white/10 whitespace-nowrap">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tint }} />
          <span className="text-white font-black text-sm">{visit.username}&apos;s base</span>
          <span className="text-sky-300 font-black text-xs">🛡️ {visit.defense}</span>
          <span className="text-amber-400 font-black text-xs">🏆 {visit.trophies}</span>
        </div>
      )}
      <div className="absolute inset-x-0 z-[70] flex items-center justify-center gap-3 px-4" style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
        <button onClick={() => router.push('/hq')}
          className="px-5 py-3.5 rounded-2xl font-black text-sm bg-black/55 backdrop-blur text-white border border-white/10 active:scale-95">
          🏠 Build your own
        </button>
        <button onClick={() => router.push('/hq/raid')}
          className="px-6 py-3.5 rounded-2xl font-black text-white text-base shadow-xl active:scale-95"
          style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
          ⚔️ Raid bases like this
        </button>
      </div>
    </div>
  )
}

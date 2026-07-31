'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trophy, Music, VolumeX } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import {
  GRID, HQ_PAD, PRINT_SHOP_PAD, PAD_UNLOCK_ORDER, BUILDINGS,
  buildingDef, buildingCost, TOWER_MAX_LEVEL,
} from '@/config/house'
import { startAmbient, stopAmbient, ambientRunning } from '@/lib/ambient'

// 🏠 CAMPAIGN HQ — the personal base (Michael 2026-07-31, CoC-lite Phase 1).
// A 4×4 yard of pads: the House and Print Shop are yours from the start, six
// pads are open to build on, and the rest of the lot is bought with FP.
// PERSONAL base only — nothing here touches town-hall control.
// Phase 2 (raids, loot, shields) is designed but deliberately not built.

interface Farm { ready: number; next_in_secs: number | null; rate_hours: number; cap: number }
interface Building { pad: number; type: string; level: number }
interface Tower { level: number; banked: number; next_in_secs: number; rate: number; interval_hours: number }
interface House {
  pads_unlocked: number; next_pad_cost: number | null; buildings: Building[]; tower: Tower | null
  trophies: number; shield_until: string | null; pickups: number
}

// where the yard sparkles sit (percent positions over the grid) — fixed table
// so a refresh doesn't shuffle them around underneath your finger
const SPARKLE_SPOTS = [
  { left: '12%', top: '68%' }, { left: '78%', top: '22%' }, { left: '55%', top: '80%' },
  { left: '25%', top: '15%' }, { left: '85%', top: '60%' },
]

export default function HqPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [farm, setFarm] = useState<Farm | null>(null)
  const [house, setHouse] = useState<House | null>(null)
  const [sheet, setSheet] = useState<{ pad: number; building?: Building } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const isRep = profile?.party === 'republican'
  const tint = isRep ? '#dc2626' : '#2563eb'

  const load = () => {
    fetch('/api/farm').then(r => r.json()).then(setFarm).catch(() => {})
    fetch('/api/house').then(r => r.json()).then(setHouse).catch(() => {})
  }
  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [])

  // ── ambient music: starts on the FIRST tap anywhere (browser autoplay
  // rules), remembered across visits, stops when you leave the page ──────────
  const [music, setMusic] = useState(false)
  const musicPref = useRef(true)
  useEffect(() => {
    try { musicPref.current = localStorage.getItem('hq_music') !== 'off' } catch {}
    const first = () => {
      if (musicPref.current && !ambientRunning()) { startAmbient(); setMusic(true) }
      window.removeEventListener('pointerdown', first)
    }
    window.addEventListener('pointerdown', first)
    return () => { window.removeEventListener('pointerdown', first); stopAmbient() }
  }, [])
  function toggleMusic() {
    if (ambientRunning()) { stopAmbient(); setMusic(false); musicPref.current = false; try { localStorage.setItem('hq_music', 'off') } catch {} }
    else { startAmbient(); setMusic(true); musicPref.current = true; try { localStorage.setItem('hq_music', 'on') } catch {} }
  }

  function say(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // yard sparkle pickups — each tap is a real server grant with a pop
  const [popped, setPopped] = useState<Array<{ id: number; left: string; top: string; text: string }>>([])
  const popId = useRef(0)
  async function pickUp(spot: { left: string; top: string }) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/house', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pickup' }),
      })
      const d = await res.json()
      if (res.ok && d.claimed > 0) {
        const id = ++popId.current
        setPopped(p => [...p, { id, ...spot, text: `+${d.claimed} FP` }])
        setTimeout(() => setPopped(p => p.filter(x => x.id !== id)), 900)
        try { navigator.vibrate?.(20) } catch {}
        load(); refetch()
      } else { load() }
    } finally { setBusy(false) }
  }

  async function act(payload: Record<string, unknown>, okMsg: (d: any) => string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/house', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (res.ok) { say(okMsg(d)); setSheet(null); load(); refetch() }
      else say(`❌ ${d.message ?? d.error ?? 'Something went wrong'}`)
    } catch { say('❌ Something went wrong') } finally { setBusy(false) }
  }

  async function claimFarm() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/farm', { method: 'POST' })
      const d = await res.json()
      if (res.ok && d.claimed > 0) say(`🧨 +${d.claimed} firecracker${d.claimed === 1 ? '' : 's'} to your bag!`)
      load()
    } finally { setBusy(false) }
  }

  // pad index → its position in the unlock order (or -1 for the fixed two)
  const orderOf = (pad: number) => PAD_UNLOCK_ORDER.indexOf(pad as any)
  const unlocked = house?.pads_unlocked ?? 6
  const builtOn = new Map((house?.buildings ?? []).map(b => [b.pad, b]))
  const hasTower = (house?.buildings ?? []).some(b => b.type === 'media_tower')
  // the NEXT purchasable pad is the first locked one in unlock order
  const nextPad = PAD_UNLOCK_ORDER[unlocked]

  function padCell(pad: number) {
    const base = 'aspect-square rounded-xl flex flex-col items-center justify-center text-center transition active:scale-95'
    // the two fixed buildings
    if (pad === HQ_PAD) {
      return (
        <div key={pad} className={`${base} border-2`} style={{ borderColor: tint, background: `${tint}18` }}>
          <span className="text-3xl leading-none">🏠</span>
          <span className="text-[10px] font-black mt-1" style={{ color: tint }}>{profile?.username ?? 'HQ'}</span>
        </div>
      )
    }
    if (pad === PRINT_SHOP_PAD) {
      const ready = (farm?.ready ?? 0) > 0
      return (
        <button key={pad} onClick={claimFarm} disabled={!ready || busy}
          className={`${base} border ${ready ? 'border-amber-400 bg-amber-500/15' : 'border-gray-700 bg-gray-900'}`}>
          <span className="text-3xl leading-none">🖨️</span>
          <span className={`text-[10px] font-bold mt-1 ${ready ? 'text-amber-300' : 'text-gray-500'}`}>
            {farm === null ? '…' : ready ? `CLAIM 🧨${farm!.ready}` : `🧨 in ${Math.max(1, Math.ceil((farm!.next_in_secs ?? 0) / 60))}m`}
          </span>
        </button>
      )
    }
    const b = builtOn.get(pad)
    if (b) {
      const def = buildingDef(b.type)
      const isTower = b.type === 'media_tower'
      const banked = isTower ? (house?.tower?.banked ?? 0) : 0
      return (
        <button key={pad} onClick={() => setSheet({ pad, building: b })}
          className={`${base} border ${banked > 0 ? 'border-emerald-400 bg-emerald-500/15' : 'border-gray-700 bg-gray-900'}`}>
          <span className="text-3xl leading-none">{def?.emoji ?? '🏗️'}</span>
          <span className="text-[10px] text-gray-400 font-bold mt-1">
            {banked > 0 ? `CLAIM ${banked} FP` : `Lv ${b.level}`}
          </span>
        </button>
      )
    }
    const pos = orderOf(pad)
    if (pos >= 0 && pos < unlocked) {
      return (
        <button key={pad} onClick={() => setSheet({ pad })}
          className={`${base} border border-dashed border-gray-700 bg-gray-900/40 hover:border-gray-500`}>
          <span className="text-gray-600 text-xl leading-none">＋</span>
          <span className="text-[10px] text-gray-600 font-bold mt-1">Build</span>
        </button>
      )
    }
    // locked lot — only the NEXT one shows its price and is tappable
    const isNext = pad === nextPad && house?.next_pad_cost != null
    return isNext ? (
      <button key={pad} onClick={() => act({ action: 'unlock_pad' }, d => `🧹 Pad cleared! (-${d.spent} FP)`)}
        className={`${base} border border-gray-800 bg-gray-950/80 hover:border-gray-600`}>
        <span className="text-lg leading-none">🌲</span>
        <span className="text-[10px] text-yellow-500 font-black mt-1">⚡{house!.next_pad_cost}</span>
      </button>
    ) : (
      <div key={pad} className={`${base} border border-gray-900 bg-gray-950/60`}>
        <span className="text-lg leading-none opacity-40">🌲</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-28">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="text-white font-black text-lg">🏠 Campaign HQ</h1>
          <button onClick={toggleMusic} className="text-gray-400 hover:text-white" title={music ? 'Music off' : 'Music on'}>
            {music ? <Music size={16} /> : <VolumeX size={16} />}
          </button>
          <span className="ml-auto flex items-center gap-3">
            <span className="text-amber-400 font-black text-sm">🏆 {house?.trophies ?? 0}</span>
            <span className="text-yellow-400 font-black text-sm">⚡ {profile?.fp_balance?.toLocaleString() ?? 0}</span>
          </span>
        </div>
        <p className="text-gray-500 text-xs mt-1.5">Your base. Build it out — clear the lot, raise the towers.</p>

        {house?.shield_until && (
          <div className="mt-3 bg-sky-950/50 border border-sky-800 rounded-xl px-4 py-2.5 text-sky-300 text-xs font-bold text-center">
            🛡️ Shield up — nobody can raid you until {new Date(house.shield_until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}

        {/* the yard */}
        <div className="mt-4 rounded-2xl border border-gray-800 p-3 relative"
          style={{ background: 'radial-gradient(circle at 30% 20%, #14231a, #0b1210 70%)' }}>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }}>
            {Array.from({ length: GRID * GRID }, (_, i) => padCell(i))}
          </div>
          {/* sparkle pickups — tap for a little FP pop */}
          {SPARKLE_SPOTS.slice(0, house?.pickups ?? 0).map((s, i) => (
            <button key={i} onClick={() => pickUp(s)}
              className="absolute text-xl animate-pulse active:scale-75 transition"
              style={{ left: s.left, top: s.top }}>✨</button>
          ))}
          {popped.map(p => (
            <span key={p.id} className="absolute text-yellow-300 font-black text-sm animate-bounce pointer-events-none"
              style={{ left: p.left, top: p.top }}>{p.text}</span>
          ))}
        </div>

        {/* raid — the other half of the game */}
        <button onClick={() => router.push('/hq/raid')}
          className="mt-4 w-full py-4 rounded-2xl font-black text-white text-lg active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg,#dc2626,#7c2d12)' }}>
          ⚔️ FIND A RAID
        </button>

        {/* HQ Collection — Michael: the collection lives at your house */}
        <button onClick={() => router.push('/collection')}
          className="mt-4 w-full bg-gray-900 rounded-2xl border border-gray-800 p-4 flex items-center gap-3 hover:border-gray-600 transition active:scale-[0.99]">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: `${tint}22` }}>
            <Trophy size={20} style={{ color: tint }} />
          </div>
          <div className="flex-1 text-left">
            <p className="text-white font-black text-sm">Your Collection</p>
            <p className="text-gray-500 text-xs">Every character you've captured, on display</p>
          </div>
          <span className="text-gray-600">›</span>
        </button>

        {/* build / manage sheet */}
        {sheet && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end" onClick={() => setSheet(null)}>
            <div className="w-full max-w-md mx-auto bg-gray-900 rounded-t-3xl border-t border-gray-700 p-5 pb-8"
              onClick={e => e.stopPropagation()}>
              {sheet.building ? (() => {
                const def = buildingDef(sheet.building!.type)!
                const isTower = def.type === 'media_tower'
                const maxLv = isTower ? TOWER_MAX_LEVEL : def.costs.length
                const nextCost = buildingCost(def.type, sheet.building!.level + 1)
                return (
                  <>
                    <p className="text-white font-black text-lg">{def.emoji} {def.name} <span className="text-gray-500 text-sm">Lv {sheet.building!.level}</span></p>
                    <p className="text-gray-500 text-xs mt-1">{def.desc}</p>
                    {isTower && house?.tower && (
                      <button disabled={busy || (house.tower.banked ?? 0) <= 0}
                        onClick={() => act({ action: 'claim_tower' }, d => `📡 +${d.claimed} FP from the airwaves!`)}
                        className="mt-4 w-full py-3 rounded-xl font-black text-black disabled:opacity-35"
                        style={{ background: 'linear-gradient(135deg,#34d399,#059669)' }}>
                        {house.tower.banked > 0 ? `CLAIM ${house.tower.banked} FP` : `Broadcasting… ${house.tower.rate} FP every ${house.tower.interval_hours}h`}
                      </button>
                    )}
                    {sheet.building!.level < maxLv && nextCost != null && (
                      <button disabled={busy}
                        onClick={() => act({ action: 'upgrade', pad: sheet.pad }, d => `⬆️ Upgraded to Lv ${d.level}! (-${d.spent} FP)`)}
                        className="mt-3 w-full py-3 rounded-xl font-black text-white bg-gray-800 border border-gray-700 hover:border-gray-500">
                        Upgrade to Lv {sheet.building!.level + 1} — ⚡{nextCost}
                      </button>
                    )}
                  </>
                )
              })() : (
                <>
                  <p className="text-white font-black text-lg">Build on this pad</p>
                  <div className="mt-3 space-y-2">
                    {Object.values(BUILDINGS).map(def => {
                      const blocked = def.unique && hasTower
                      return (
                        <button key={def.type} disabled={busy || !!blocked}
                          onClick={() => act({ action: 'build', pad: sheet.pad, type: def.type }, d => `${def.emoji} ${def.name} built! (-${d.spent} FP)`)}
                          className="w-full bg-gray-800 rounded-xl border border-gray-700 p-3 flex items-center gap-3 hover:border-gray-500 disabled:opacity-40 text-left">
                          <span className="text-2xl">{def.emoji}</span>
                          <span className="flex-1">
                            <span className="text-white font-bold text-sm block">{def.name}{blocked ? ' (already built)' : ''}</span>
                            <span className="text-gray-500 text-[11px]">{def.desc}</span>
                          </span>
                          <span className="text-yellow-400 font-black text-sm">⚡{def.costs[0]}</span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
            <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
          </div>
        )}
      </div>
    </div>
  )
}

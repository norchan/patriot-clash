'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, GripVertical } from 'lucide-react'

// ORGANIZE pSUBS (Michael): the pSubs exactly as the boards scroll shows
// them — GRAB the ≡ handle and drag a pSub where you want it (no more
// up/down arrows), switch off the ones you don't want. p/all is locked on
// (it's the landing tab). Saves to the account for signed-in players
// (follows you across devices) and to this device for guests.

interface Row { slug: string; on: boolean }

export default function OrganizePsubs({ initialTabs, prefs, signedIn }: {
  initialTabs: string[]
  prefs: { order?: string[]; hidden?: string[] } | null
  signedIn: boolean
}) {
  const router = useRouter()
  const orderPref = (prefs?.order ?? []).filter(t => initialTabs.includes(t))
  const ordered = orderPref.length
    ? [...orderPref, ...initialTabs.filter(t => !orderPref.includes(t))]
    : initialTabs
  const hidden = new Set(prefs?.hidden ?? [])
  const [rows, setRows] = useState<Row[]>(ordered.map(slug => ({ slug, on: slug === 'all' || !hidden.has(slug) })))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // ── grab-and-drag reordering (Michael: "a grab hold method") ────────────
  // Pointer-based, no library: grip a row's ≡ handle, drag — crossing 60% of
  // a row's height swaps positions live; release drops it where it sits.
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOff, setDragOff] = useState(0)
  const rowsRef = useRef(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])

  function grip(e: React.PointerEvent, i: number) {
    e.preventDefault()
    const rowEl = (e.currentTarget as HTMLElement).closest('[data-row]') as HTMLElement | null
    const d = { idx: i, startY: e.clientY, rowH: rowEl?.offsetHeight ?? 46 }
    setDragIdx(i)
    setDragOff(0)
    setSaved(false)
    const move = (ev: PointerEvent) => {
      let off = ev.clientY - d.startY
      while (off > d.rowH * 0.6 && d.idx < rowsRef.current.length - 1) {
        const from = d.idx
        setRows(r => { const n = [...r]; [n[from], n[from + 1]] = [n[from + 1], n[from]]; return n })
        d.idx += 1; d.startY += d.rowH; off -= d.rowH
        setDragIdx(d.idx)
      }
      while (off < -d.rowH * 0.6 && d.idx > 0) {
        const from = d.idx
        setRows(r => { const n = [...r]; [n[from], n[from - 1]] = [n[from - 1], n[from]]; return n })
        d.idx -= 1; d.startY -= d.rowH; off += d.rowH
        setDragIdx(d.idx)
      }
      setDragOff(off)
    }
    const up = () => {
      setDragIdx(null)
      setDragOff(0)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const toggle = (i: number) => {
    if (rows[i].slug === 'all') return
    const next = [...rows]
    next[i] = { ...next[i], on: !next[i].on }
    setRows(next)
    setSaved(false)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    const body = { order: rows.map(r => r.slug), hidden: rows.filter(r => !r.on).map(r => r.slug) }
    try { localStorage.setItem('pg_tab_prefs', JSON.stringify(body)) } catch {}
    if (signedIn) {
      try { await fetch('/api/boards/prefs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } catch {}
    }
    setSaving(false)
    setSaved(true)
    router.push('/boards')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 pb-28">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/boards')} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="text-white font-black text-lg">Organize pSubs</h1>
        </div>
        <p className="text-gray-500 text-xs mt-1.5">
          Hold the ≡ handle and drag a pSub where you want it; switch off the ones you don&rsquo;t want. p/all always stays on.
        </p>

        <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.slug} data-row
              className={`flex items-center gap-2 px-3 py-2.5 border-b border-gray-800/60 last:border-0 ${r.on ? '' : 'opacity-45'} ${dragIdx === i ? 'bg-purple-950/40' : ''}`}
              style={dragIdx === i
                ? { transform: `translateY(${dragOff}px)`, position: 'relative', zIndex: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }
                : dragIdx !== null ? { transition: 'transform 120ms ease' } : undefined}>
              {/* grab handle — hold and drag the pSub where you want it */}
              <span onPointerDown={e => grip(e, i)}
                className="shrink-0 w-9 h-9 -ml-1 rounded-lg flex items-center justify-center text-gray-500 hover:text-white cursor-grab active:cursor-grabbing"
                style={{ touchAction: 'none' }} aria-label="Drag to reorder">
                <GripVertical size={17} />
              </span>
              <span className="flex-1 text-sm font-bold text-gray-200 truncate select-none">p/{r.slug}</span>
              <button onClick={() => toggle(i)} disabled={r.slug === 'all'} aria-label={r.on ? 'Turn off' : 'Turn on'}
                className={`relative w-12 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${r.on ? 'bg-green-600' : 'bg-gray-700'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${r.on ? 'left-6' : 'left-0.5'}`} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={save} disabled={saving}
          className="mt-4 w-full py-3.5 rounded-2xl font-black text-white transition active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save & back to Boards'}
        </button>
        {!signedIn && (
          <p className="text-gray-600 text-[11px] text-center mt-2">Saved on this device — create an account to keep it everywhere.</p>
        )}
      </div>
    </div>
  )
}

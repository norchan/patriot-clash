'use client'
import { useState, useEffect, useRef, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Minus, Plus, Volume2, VolumeX } from 'lucide-react'
import { getMachine, BET_OPTIONS, REELS, ROWS, WILD, SCATTER, BG_SPOTS } from '@/config/slots'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/slot-sfx'

const N = 8 // symbols in a machine
const rnd = () => Math.floor(Math.random() * N)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const key = (r: number, row: number) => `${r},${row}`

interface Banner { label: string; sub?: string; amount?: number; color: string }
interface Coin { id: number; left: number; delay: number; dur: number; e: string }

export default function SlotMachinePage({ params }: { params: Promise<{ machine: string }> }) {
  const { machine: machineId } = use(params)
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const m = getMachine(machineId)

  const [grid, setGrid] = useState<number[][]>(() => Array.from({ length: REELS }, () => Array.from({ length: ROWS }, rnd)))
  const [strips, setStrips] = useState<number[][]>(() => Array.from({ length: REELS }, () => Array.from({ length: 10 }, rnd)))
  const [spinning, setSpinning] = useState<boolean[]>(() => Array(REELS).fill(false))
  const [antic, setAntic] = useState<boolean[]>(() => Array(REELS).fill(false))
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [betIdx, setBetIdx] = useState(0)
  const [balance, setBalance] = useState<number | null>(null)
  const [winMeter, setWinMeter] = useState(0)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [coins, setCoins] = useState<Coin[]>([])
  const [fs, setFs] = useState<{ remaining: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [muted, setMuted] = useState(false)
  const [flash, setFlash] = useState('')

  const bet = BET_OPTIONS[betIdx]
  const mounted = useRef(true)
  const autoRef = useRef(false)
  const mutedRef = useRef(false)
  const busyRef = useRef(false)
  const balRef = useRef<number | null>(null)
  const coinId = useRef(0)

  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => { autoRef.current = auto }, [auto])
  useEffect(() => { if (profile && balance === null) { setBalance(profile.fp_balance); balRef.current = profile.fp_balance } }, [profile, balance])
  useEffect(() => () => { mounted.current = false; sfx.stopSpin() }, [])

  // sound gate
  const S = useCallback(<T extends any[]>(fn: (...a: T) => void) => (...a: T) => { if (!mutedRef.current) fn(...a) }, [])

  if (!m) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white gap-3">
        <p>Machine not found.</p>
        <button onClick={() => router.push('/arcade/slots')} className="text-green-400">← Back to Slots</button>
      </div>
    )
  }

  function popCoins(n: number) {
    const batch: Coin[] = Array.from({ length: n }, () => ({
      id: coinId.current++, left: Math.random() * 100, delay: Math.random() * 0.5,
      dur: 1.1 + Math.random() * 0.9, e: Math.random() < 0.5 ? '🪙' : '💰',
    }))
    setCoins(c => [...c, ...batch])
    setTimeout(() => { if (mounted.current) setCoins(c => c.filter(x => !batch.find(b => b.id === x.id))) }, 2600)
  }

  async function countTo(amount: number, ms: number) {
    const steps = Math.min(28, Math.max(8, Math.floor(ms / 45)))
    for (let i = 1; i <= steps; i++) {
      if (!mounted.current) return
      setWinMeter(Math.floor((amount * i) / steps))
      if (i % 2 === 0) S(sfx.coinTick)()
      await sleep(ms / steps)
    }
    setWinMeter(amount)
  }

  function winLevel(payout: number): { level: number; label: string; color: string } | null {
    const r = payout / bet
    if (r >= 50) return { level: 3, label: 'EPIC WIN', color: '#f0abfc' }
    if (r >= 20) return { level: 2, label: 'MEGA WIN', color: '#fde047' }
    if (r >= 8) return { level: 1, label: 'BIG WIN', color: '#4ade80' }
    return null
  }

  // Land the reels one at a time for a given grid, with optional anticipation.
  async function dropReels(target: number[][], anticipate: boolean) {
    for (let i = 0; i < REELS; i++) {
      const long = anticipate && i >= 3
      if (long) { setAntic(a => a.map((v, j) => j === i ? true : v)); S(sfx.anticipation)(1300); await sleep(1300) }
      else await sleep(i === 0 ? 420 : 300)
      if (!mounted.current) return
      setGrid(g => g.map((col, j) => j === i ? target[i] : col))
      setSpinning(s => s.map((v, j) => j === i ? false : v))
      setAntic(a => a.map((v, j) => j === i ? false : v))
      if (target[i].includes(SCATTER)) S(sfx.scatterLand)(target[i].filter(x => x === SCATTER).length)
      else S(sfx.reelStop)()
    }
  }

  async function settle(spin: { wins: any[]; payout: number }, addBanner: boolean) {
    if (spin.wins.length) {
      const hl = new Set<string>()
      for (const w of spin.wins) for (const [r, row] of w.positions) hl.add(key(r, row))
      setHighlight(hl)
    }
    if (spin.payout > 0) {
      const lvl = winLevel(spin.payout)
      if (lvl) { S(sfx.bigWin)(lvl.level); popCoins(18 + lvl.level * 10); if (addBanner) setBanner({ label: lvl.label, amount: spin.payout, color: lvl.color }) }
      else S(sfx.win)()
      await countTo(spin.payout, lvl ? 1400 : 700)
      await sleep(lvl ? 1100 : 400)
      if (addBanner) setBanner(null)
    } else {
      S(sfx.lose)()
    }
    if (mounted.current) setHighlight(new Set())
  }

  async function runFreeSpins(freeSpins: any[]) {
    setBanner({ label: 'FREE SPINS!', sub: `${freeSpins.length} bonus spins`, color: '#fde047' })
    S(sfx.freeSpinsFanfare)()
    await sleep(2000)
    setBanner(null)
    let total = 0
    setFs({ remaining: freeSpins.length, total: 0 })
    for (let idx = 0; idx < freeSpins.length; idx++) {
      if (!mounted.current) return
      const spin = freeSpins[idx]
      setFs({ remaining: freeSpins.length - idx, total })
      setStrips(Array.from({ length: REELS }, () => Array.from({ length: 10 }, rnd)))
      setSpinning(Array(REELS).fill(true))
      setWinMeter(0)
      S(sfx.spinStart)()
      await sleep(420)
      for (let i = 0; i < REELS; i++) {
        setGrid(g => g.map((col, j) => j === i ? spin.grid[i] : col))
        setSpinning(s => s.map((v, j) => j === i ? false : v))
        S(sfx.reelStop)()
        await sleep(110)
      }
      sfx.stopSpin()
      if (spin.payout > 0) { total += spin.payout; await settle(spin, false) }
      else await sleep(250)
    }
    setFs({ remaining: 0, total })
    setBanner({ label: 'BONUS WIN', amount: total, color: '#fde047' })
    S(sfx.bigWin)(3)
    popCoins(40)
    await sleep(2600)
    if (mounted.current) { setBanner(null); setFs(null) }
  }

  async function spin() {
    if (busyRef.current || balRef.current === null) return
    if (balRef.current < bet) { setAuto(false); setFlash('Not enough FP for that bet'); setTimeout(() => setFlash(''), 1800); return }

    busyRef.current = true
    setBusy(true)
    setBanner(null); setHighlight(new Set()); setWinMeter(0)
    const optimistic = (balRef.current ?? 0) - bet
    setBalance(optimistic); balRef.current = optimistic
    setStrips(Array.from({ length: REELS }, () => Array.from({ length: 10 }, rnd)))
    setSpinning(Array(REELS).fill(true))
    S(sfx.spinStart)()

    let data: any
    try {
      const res = await fetch('/api/arcade/slots/spin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine: m!.id, bet }),
      })
      data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'spin failed')
    } catch (e: any) {
      sfx.stopSpin(); setSpinning(Array(REELS).fill(false)); busyRef.current = false; setBusy(false)
      setAuto(false)
      if (profile) { setBalance(profile.fp_balance); balRef.current = profile.fp_balance }
      setFlash(e?.message === 'INSUFFICIENT_FP' ? 'Not enough FP' : 'Spin failed, try again')
      setTimeout(() => setFlash(''), 1800)
      return
    }

    const anticipate = data.base.scatterPositions.filter(([r]: number[]) => r <= 2).length >= 2
    await dropReels(data.base.grid, anticipate)
    sfx.stopSpin()
    await settle(data.base, true)
    if (data.freeSpins?.length) await runFreeSpins(data.freeSpins)

    if (mounted.current) {
      setBalance(data.balance); balRef.current = data.balance
      setWinMeter(data.totalPayout)
      refetch()
    }
    busyRef.current = false
    setBusy(false)

    if (autoRef.current && mounted.current && (balRef.current ?? 0) >= bet) {
      await sleep(600)
      if (autoRef.current && mounted.current) spin()
    }
  }

  const cell = 74
  const inFs = !!fs

  return (
    <div className="min-h-screen text-white relative select-none overflow-hidden" style={{ background: m.bg, fontFamily: 'ui-monospace, monospace' }}>
      {/* themed background art — fills the empty space with the machine's world */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {BG_SPOTS.map((s, i) => (
          <span key={i} className="absolute"
            style={{ top: `${s.top}%`, left: `${s.left}%`, transform: `rotate(${s.rot}deg)`, opacity: 0.14 }}>
            <span className="block" style={{
              fontSize: s.size,
              filter: `drop-shadow(0 0 10px ${m.accent})`,
              animation: `bgfloat ${5 + (i % 4)}s ease-in-out ${s.delay}s infinite`,
            }}>
              {m.bgIcons[i % m.bgIcons.length]}
            </span>
          </span>
        ))}
      </div>

      {/* header */}
      <div className="px-4 pt-4 pb-1 flex items-center gap-3 relative z-20">
        <button onClick={() => router.push('/arcade/slots')} className="text-white/70 hover:text-white transition"><ArrowLeft size={18} /></button>
        <span className="text-white/50 text-xs tracking-widest">LOBBY</span>
        <button onClick={() => setMuted(v => !v)} className="ml-auto text-white/60 hover:text-white">{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
      </div>

      {/* marquee */}
      <div className="text-center pt-1 pb-2 relative z-20">
        <h1 className="font-black tracking-[0.08em] text-3xl" style={{ color: m.accent, textShadow: `0 0 14px ${m.accent}, 0 2px 0 #000` }}>{m.name}</h1>
      </div>

      {/* jackpot ribbon */}
      <div className="mx-auto max-w-sm px-4 relative z-20">
        <div className="flex gap-2 justify-center">
          {['MINI', 'MINOR', 'MAJOR', 'GRAND'].map((t, i) => (
            <div key={t} className="flex-1 rounded-lg text-center py-1 border"
              style={{ background: 'rgba(0,0,0,0.35)', borderColor: `${m.accent}66` }}>
              <div className="text-[8px] tracking-widest text-white/50">{t}</div>
              <div className="text-[11px] font-black" style={{ color: [ '#fbbf24','#f59e0b','#f472b6','#facc15'][i] }}>
                {[ (bet*20).toLocaleString(), (bet*100).toLocaleString(), (bet*500).toLocaleString(), (bet*2500).toLocaleString() ][i]}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* reel cabinet — 3D: the whole face leans back like a real machine, each
          reel is shaded as a curved drum and the rows wrap around it */}
      <div className="mx-auto max-w-sm px-4 mt-3 relative z-20" style={{ perspective: 950 }}>
        <div className="rounded-2xl p-2.5" style={{
          background: m.frame,
          transform: 'rotateX(7deg)', transformOrigin: '50% 0%',
          boxShadow: `0 0 26px ${m.accent}88, 0 18px 30px -10px rgba(0,0,0,0.8), inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.55)`,
        }}>
          {/* metallic bezel lip */}
          <div className="rounded-xl p-2 relative" style={{
            background: 'linear-gradient(180deg, rgba(0,0,0,0.7), rgba(0,0,0,0.5))',
            boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(255,255,255,0.12)',
          }}>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${REELS}, 1fr)` }}>
              {Array.from({ length: REELS }).map((_, ri) => (
                <div key={ri} className="rounded-lg overflow-hidden relative"
                  style={{ height: cell * ROWS, background: m.reelBg, perspective: 420, boxShadow: antic[ri] ? `0 0 16px 3px #fde047, inset 0 0 12px #f59e0b` : 'inset 0 2px 6px rgba(0,0,0,0.25)' }}>
                  {spinning[ri] ? (
                    <div style={{ animation: `reelspin ${0.22 + ri * 0.02}s linear infinite`, filter: 'blur(0.6px)' }}>
                      {strips[ri].concat(strips[ri]).map((sym, k) => (
                        <SymCell key={k} m={m} sym={sym} size={cell} />
                      ))}
                    </div>
                  ) : (
                    grid[ri].map((sym, row) => (
                      <SymCell key={row} m={m} sym={sym} size={cell} row={row} glow={highlight.has(key(ri, row))} dim={highlight.size > 0 && !highlight.has(key(ri, row))} land />
                    ))
                  )}
                  {/* curved-drum shading: dark wrap at top/bottom, lit center band */}
                  <div className="absolute inset-0 pointer-events-none" style={{
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.52), rgba(0,0,0,0.08) 22%, rgba(255,255,255,0.07) 46%, rgba(255,255,255,0.07) 54%, rgba(0,0,0,0.08) 78%, rgba(0,0,0,0.52))',
                  }} />
                  {antic[ri] && <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(253,224,71,0.25), transparent 70%)' }} />}
                </div>
              ))}
            </div>
            {/* glass reflection across the reel window */}
            <div className="absolute inset-2 rounded-lg pointer-events-none" style={{
              background: 'linear-gradient(115deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04) 24%, transparent 38%)',
            }} />
          </div>
        </div>
      </div>

      {/* meters */}
      <div className="mx-auto max-w-sm px-4 mt-3 relative z-20">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Meter label="BALANCE" value={`${(balance ?? 0).toLocaleString()}`} color="#fbbf24" />
          <Meter label={inFs ? `FREE SPINS` : 'TOTAL BET'} value={inFs ? `${fs!.remaining} left` : `${bet}`} color={inFs ? '#f472b6' : '#e5e7eb'} />
          <Meter label={inFs ? 'BONUS WIN' : 'WIN'} value={`${(inFs ? fs!.total + winMeter : winMeter).toLocaleString()}`} color="#4ade80" />
        </div>
      </div>

      {/* controls */}
      <div className="mx-auto max-w-sm px-4 mt-3 pb-24 relative z-20">
        <div className="flex items-center gap-3">
          {/* bet stepper */}
          <div className="flex items-center gap-1 bg-black/40 rounded-full p-1 border" style={{ borderColor: `${m.accent}55` }}>
            <button disabled={busy || inFs || betIdx === 0} onClick={() => setBetIdx(i => Math.max(0, i - 1))}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center disabled:opacity-30"><Minus size={15} /></button>
            <div className="text-center w-16">
              <div className="text-[9px] text-white/50 tracking-widest">BET</div>
              <div className="font-black text-sm" style={{ color: m.accent }}>{bet} FP</div>
            </div>
            <button disabled={busy || inFs || betIdx === BET_OPTIONS.length - 1} onClick={() => setBetIdx(i => Math.min(BET_OPTIONS.length - 1, i + 1))}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center disabled:opacity-30"><Plus size={15} /></button>
          </div>

          {/* spin */}
          <button onClick={spin} disabled={busy}
            className="flex-1 h-16 rounded-2xl font-black text-xl tracking-widest transition active:translate-y-[3px] disabled:opacity-70 relative overflow-hidden"
            style={{ background: 'radial-gradient(circle at 50% 30%, #34d399, #15803d)', color: '#052e16',
              boxShadow: '0 5px 0 #14532d, 0 9px 16px rgba(0,0,0,0.55), 0 0 22px rgba(34,197,94,0.5), inset 0 2px 0 rgba(255,255,255,0.5)' }}>
            {busy ? (inFs ? 'BONUS' : '···') : 'SPIN'}
          </button>

          {/* auto */}
          <button onClick={() => setAuto(v => !v)} disabled={inFs}
            className="w-14 h-16 rounded-2xl font-black text-[11px] tracking-wide transition active:scale-95 disabled:opacity-40"
            style={{ background: auto ? m.accent : 'rgba(255,255,255,0.08)', color: auto ? '#0a0616' : '#fff', border: `1px solid ${auto ? m.accent : 'rgba(255,255,255,0.15)'}` }}>
            AUTO<br />{auto ? 'ON' : 'OFF'}
          </button>
        </div>
        {flash && <p className="text-center text-red-400 text-sm mt-2 font-bold">{flash}</p>}
        <p className="text-center text-white/30 text-[10px] mt-3 tracking-wide">243 WAYS · 🌟 WILD substitutes · 3+ 🎁 BONUS = FREE SPINS</p>
      </div>

      {/* coin shower */}
      {coins.length > 0 && (
        <div className="fixed inset-0 pointer-events-none z-40 max-w-md mx-auto">
          {coins.map(c => (
            <span key={c.id} className="absolute text-2xl" style={{ left: `${c.left}%`, top: -30, animation: `coinfall ${c.dur}s ease-in ${c.delay}s forwards` }}>{c.e}</span>
          ))}
        </div>
      )}

      {/* win / bonus banner */}
      {banner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none max-w-md mx-auto px-6">
          <div className="text-center" style={{ animation: 'bannerPop 0.4s ease-out' }}>
            <div className="text-5xl font-black" style={{ color: banner.color, textShadow: `0 0 24px ${banner.color}, 0 3px 0 #000` }}>{banner.label}</div>
            {banner.sub && <div className="text-white/80 text-sm mt-1 tracking-widest">{banner.sub}</div>}
            {banner.amount != null && (
              <div className="text-4xl font-black text-white mt-2" style={{ textShadow: '0 0 18px #22c55e' }}>+{winMeter.toLocaleString()} FP</div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes reelspin { from { transform: translateY(0) } to { transform: translateY(-${cell * 10}px) } }
        @keyframes coinfall { to { transform: translateY(110vh) rotate(540deg); opacity: 0.2 } }
        @keyframes bannerPop { 0% { transform: scale(0.4); opacity: 0 } 60% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes landbounce { 0% { transform: translateY(-14%) } 60% { transform: translateY(4%) } 100% { transform: translateY(0) } }
        @keyframes cellglow { 0%,100% { transform: scale(1) } 50% { transform: scale(1.14) } }
        @keyframes bgfloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-12px) } }
      `}</style>
    </div>
  )
}

function SymCell({ m, sym, size, row, glow, dim, land }: { m: any; sym: number; size: number; row?: number; glow?: boolean; dim?: boolean; land?: boolean }) {
  const s = m.symbols[sym]
  const isWild = sym === WILD, isScat = sym === SCATTER
  // wrap the visible rows around the drum: top row tilts away up, bottom away down
  const drumTilt = row === 0 ? 'rotateX(26deg)' : row === 2 ? 'rotateX(-26deg)' : undefined
  return (
    <div className="flex items-center justify-center relative"
      style={{ height: size, transform: drumTilt, transformOrigin: row === 0 ? '50% 100%' : row === 2 ? '50% 0%' : undefined }}>
      <div className="absolute inset-0 flex items-center justify-center"
        style={{
          animation: glow ? 'cellglow 0.6s ease-in-out infinite' : land ? 'landbounce 0.28s ease-out' : undefined,
          opacity: dim ? 0.4 : 1,
          background: glow ? 'radial-gradient(circle, rgba(253,224,71,0.5), transparent 72%)' : isWild ? 'radial-gradient(circle, rgba(250,204,21,0.28), transparent 72%)' : isScat ? 'radial-gradient(circle, rgba(236,72,153,0.28), transparent 72%)' : undefined,
        }}>
        <span style={{ fontSize: size * 0.5, filter: glow ? 'drop-shadow(0 0 6px #facc15)' : 'drop-shadow(0 3px 3px rgba(0,0,0,0.45))' }}>{s.emoji}</span>
        {s.label && (
          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-black tracking-wider px-1 rounded"
            style={{ color: '#111', background: isWild ? '#facc15' : '#f9a8d4' }}>{s.label}</span>
        )}
      </div>
    </div>
  )
}

function Meter({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg py-1.5 border" style={{ background: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.08)' }}>
      <div className="text-[8px] tracking-widest text-white/45">{label}</div>
      <div className="font-black text-base tabular-nums" style={{ color }}>{value}</div>
    </div>
  )
}

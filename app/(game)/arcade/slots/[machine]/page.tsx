'use client'
import { useState, useEffect, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getMachine, BET_OPTIONS } from '@/config/slots'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/slot-sfx'

const N = 6 // symbols per machine
const rand = () => Math.floor(Math.random() * N)

export default function SlotMachinePage({ params }: { params: Promise<{ machine: string }> }) {
  const { machine: machineId } = use(params)
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const m = getMachine(machineId)

  // reel[reelIndex] = [topRow, centerRow(payline), bottomRow] symbol indices
  const [reels, setReels] = useState<number[][]>([[0, 1, 2], [3, 4, 5], [1, 2, 0]])
  const [spinning, setSpinning] = useState(false)
  const [bet, setBet] = useState<number>(5)
  const [balance, setBalance] = useState<number | null>(null)
  const [result, setResult] = useState<{ payout: number; jackpot: boolean } | null>(null)
  const [flash, setFlash] = useState('')
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (profile && balance === null) setBalance(profile.fp_balance)
  }, [profile, balance])

  useEffect(() => () => { if (cycleRef.current) clearInterval(cycleRef.current); sfx.stopSpin() }, [])

  if (!m) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white gap-3">
        <p>Machine not found.</p>
        <button onClick={() => router.push('/arcade/slots')} className="text-green-400">← Back to Slots</button>
      </div>
    )
  }

  async function spin() {
    if (spinning || balance === null) return
    if (balance < bet) { setFlash('Not enough FP for that bet'); setTimeout(() => setFlash(''), 1800); return }

    setResult(null)
    setSpinning(true)
    setBalance(b => (b ?? 0) - bet) // optimistic; server confirms
    sfx.spinStart()

    // spin all reels visually
    const stopped = [false, false, false]
    cycleRef.current = setInterval(() => {
      setReels(prev => prev.map((r, i) => stopped[i] ? r : [rand(), rand(), rand()]))
    }, 70)

    let data: any
    try {
      const res = await fetch('/api/arcade/slots/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine: m!.id, bet }),
      })
      data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'spin failed')
    } catch (e: any) {
      if (cycleRef.current) clearInterval(cycleRef.current)
      sfx.stopSpin()
      setSpinning(false)
      if (profile) setBalance(profile.fp_balance)
      setFlash(e?.message === 'INSUFFICIENT_FP' ? 'Not enough FP' : 'Spin failed, try again')
      setTimeout(() => setFlash(''), 1800)
      return
    }

    const finalReels: number[] = data.reels
    const minSpin = 550
    // stagger the three reels to a stop
    const stops = [minSpin, minSpin + 380, minSpin + 780]
    stops.forEach((delay, i) => {
      setTimeout(() => {
        stopped[i] = true
        setReels(prev => prev.map((r, j) => j === i ? [rand(), finalReels[i], rand()] : r))
        sfx.reelStop()
        if (i === 2) finishSpin(data)
      }, delay)
    })
  }

  function finishSpin(data: any) {
    if (cycleRef.current) clearInterval(cycleRef.current)
    sfx.stopSpin()
    setBalance(data.balance)
    setSpinning(false)
    refetch()
    if (data.payout > 0) {
      if (data.jackpot || data.mult >= 40) sfx.jackpot()
      else sfx.win()
      setResult({ payout: data.payout, jackpot: data.jackpot })
      setTimeout(() => setResult(null), 3500)
    } else {
      sfx.lose()
    }
  }

  return (
    <div className="min-h-screen text-white relative select-none" style={{ background: m.bg, fontFamily: 'ui-monospace, monospace' }}>
      {/* header */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.push('/arcade/slots')} className="text-white/70 hover:text-white transition">
          <ArrowLeft size={18} />
        </button>
        <span className="text-white/60 text-xs tracking-widest">MACHINES</span>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()} FP</span>
      </div>

      {/* marquee */}
      <div className="text-center pt-2 pb-3">
        <h1 className="font-black tracking-[0.1em] text-3xl" style={{ color: m.accent, textShadow: `0 0 10px ${m.accent}, 0 2px 0 #000` }}>
          {m.name}
        </h1>
        <p className="text-white/50 text-[11px] tracking-wide mt-0.5">{m.subtitle}</p>
      </div>

      {/* reel window */}
      <div className="mx-auto max-w-sm px-4">
        <div className="relative rounded-2xl p-3" style={{ background: `linear-gradient(180deg, ${m.accent}, #000)`, boxShadow: `0 0 24px ${m.accent}88` }}>
          <div className="grid grid-cols-3 gap-2">
            {reels.map((rows, ri) => (
              <div key={ri} className="rounded-xl overflow-hidden" style={{ background: m.reelBg }}>
                {rows.map((sym, row) => (
                  <div key={row}
                    className="flex items-center justify-center transition-transform"
                    style={{
                      height: 78,
                      fontSize: row === 1 ? 46 : 34,
                      opacity: row === 1 ? 1 : 0.35,
                      filter: row === 1 ? 'none' : 'grayscale(0.3)',
                      borderTop: row === 1 ? '2px solid rgba(0,0,0,0.15)' : 'none',
                      borderBottom: row === 1 ? '2px solid rgba(0,0,0,0.15)' : 'none',
                    }}>
                    {m.symbols[sym].emoji}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* payline marker */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none flex justify-between px-1">
            <span className="text-lg" style={{ color: m.accent }}>▶</span>
            <span className="text-lg" style={{ color: m.accent }}>◀</span>
          </div>

          {/* win overlay */}
          {result && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl pointer-events-none"
              style={{ background: 'rgba(0,0,0,0.45)' }}>
              <div className="text-center animate-pulse">
                <div className="text-2xl font-black" style={{ color: '#fde047', textShadow: '0 0 12px #f59e0b' }}>
                  {result.jackpot ? '🎉 JACKPOT! 🎉' : 'WIN!'}
                </div>
                <div className="text-4xl font-black text-green-400" style={{ textShadow: '0 0 12px #22c55e' }}>
                  +{result.payout.toLocaleString()} FP
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* bet selector */}
      <div className="mx-auto max-w-sm px-4 mt-5">
        <p className="text-center text-white/50 text-[11px] tracking-widest mb-2">BET PER SPIN</p>
        <div className="grid grid-cols-4 gap-2">
          {BET_OPTIONS.map(b => (
            <button key={b}
              onClick={() => !spinning && setBet(b)}
              disabled={spinning}
              className="py-2.5 rounded-xl font-black text-sm transition active:scale-95 disabled:opacity-50"
              style={{
                background: bet === b ? m.accent : 'rgba(255,255,255,0.08)',
                color: bet === b ? '#0a0616' : '#fff',
                border: `1px solid ${bet === b ? m.accent : 'rgba(255,255,255,0.15)'}`,
              }}>
              {b} FP
            </button>
          ))}
        </div>
      </div>

      {/* spin button */}
      <div className="mx-auto max-w-sm px-4 mt-5">
        <button onClick={spin} disabled={spinning}
          className="w-full py-4 rounded-2xl font-black text-2xl tracking-widest transition active:scale-95 disabled:opacity-60"
          style={{
            background: 'linear-gradient(180deg, #22c55e, #15803d)',
            color: '#052e16',
            boxShadow: '0 0 20px rgba(34,197,94,0.5), inset 0 2px 0 rgba(255,255,255,0.4)',
          }}>
          {spinning ? '···' : 'SPIN!'}
        </button>
        {flash && <p className="text-center text-red-400 text-sm mt-2 font-bold">{flash}</p>}
      </div>

      {/* paytable */}
      <div className="mx-auto max-w-sm px-4 mt-6 pb-28">
        <p className="text-center text-white/40 text-[10px] tracking-widest mb-2">— PAYTABLE (× BET) —</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {m.symbols.map((s, i) => {
            const pay3 = [200, 80, 40, 20, 10, 4][i]
            return (
              <div key={i} className="rounded-lg py-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="text-2xl">{s.emoji}{s.emoji}{s.emoji}</div>
                <div className="text-yellow-300 text-xs font-black">×{pay3}</div>
              </div>
            )
          })}
        </div>
        <p className="text-center text-white/30 text-[10px] mt-2">Two matching symbols also pay. Match three for the big prizes.</p>
      </div>
    </div>
  )
}

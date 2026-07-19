'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { useSteps } from '@/hooks/useSteps'

// Step Tracker — tap the 👟 bubble on the map or the steps card on your
// profile. Big daily ring, streaks, a 14-day chart, lifetime milestones.
// Walking is the free FP engine: 100 FP per 150 steps, 30k/day counted.

type DayRec = { record_date: string; step_count: number; fp_awarded: number }
const DAILY_GOAL = 10_000
const STREAK_MIN = 2_000 // steps that make a day "count" toward the streak

const MILESTONES: { at: number; label: string; emoji: string }[] = [
  { at: 25_000, label: 'First Marcher', emoji: '👟' },
  { at: 100_000, label: 'Precinct Walker', emoji: '🚶' },
  { at: 250_000, label: 'District Runner', emoji: '🏃' },
  { at: 500_000, label: 'State Strider', emoji: '⭐' },
  { at: 1_000_000, label: 'MILLION STEP CLUB', emoji: '🏆' },
  { at: 2_000_000, label: 'Campaign Legend', emoji: '👑' },
]

export default function StepsPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const { steps: liveSteps, fpEarned } = useSteps()
  const [history, setHistory] = useState<DayRec[]>([])
  const [shown, setShown] = useState(0) // animated count-up

  useEffect(() => {
    fetch('/api/steps').then(r => r.json()).then(d => setHistory(d.steps ?? [])).catch(() => {})
  }, [])

  const todayStr = new Date().toISOString().split('T')[0]
  const serverToday = history.find(h => h.record_date === todayStr)
  const today = Math.max(liveSteps, serverToday?.step_count ?? 0)
  const todayFp = Math.max(fpEarned, serverToday?.fp_awarded ?? 0)

  // animated count-up toward today's number
  const target = useRef(0)
  useEffect(() => {
    target.current = today
    let raf: number
    const tick = () => {
      setShown(v => {
        const d = target.current - v
        if (Math.abs(d) < 2) return target.current
        return v + Math.ceil(d * 0.12)
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [today])

  // streak: consecutive days ≥ STREAK_MIN ending today (or yesterday if today hasn't hit it yet)
  const streak = useMemo(() => {
    const byDate = new Map(history.map(h => [h.record_date, h.step_count]))
    if (today >= STREAK_MIN) byDate.set(todayStr, today)
    let n = 0
    const d = new Date()
    if ((byDate.get(todayStr) ?? 0) < STREAK_MIN) d.setDate(d.getDate() - 1) // grace: today still in progress
    for (;;) {
      const key = d.toISOString().split('T')[0]
      if ((byDate.get(key) ?? 0) >= STREAK_MIN) { n++; d.setDate(d.getDate() - 1) } else break
    }
    return n
  }, [history, today, todayStr])

  // last 14 days for the chart (fill gaps with 0)
  const chart = useMemo(() => {
    const byDate = new Map(history.map(h => [h.record_date, h.step_count]))
    if (today > 0) byDate.set(todayStr, today)
    const out: { date: string; label: string; steps: number; isToday: boolean }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      out.push({
        date: key,
        label: 'SMTWTFS'[d.getDay()],
        steps: byDate.get(key) ?? 0,
        isToday: i === 0,
      })
    }
    return out
  }, [history, today, todayStr])
  const chartMax = Math.max(DAILY_GOAL, ...chart.map(c => c.steps))

  const lifetime = Math.max(profile?.total_steps ?? 0, 0)
  const miles = (lifetime / 2000).toFixed(1)
  const pct = Math.min(1, today / DAILY_GOAL)
  const R = 84, CIRC = 2 * Math.PI * R

  const nextMilestone = MILESTONES.find(m => lifetime < m.at)

  return (
    <div className="min-h-screen text-white pb-28 select-none"
      style={{ background: 'radial-gradient(circle at 50% -10%, #14532d 0%, #052e16 45%, #020a05 100%)', fontFamily: 'ui-monospace, monospace' }}>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-white/70 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.12em] text-lg" style={{ color: '#4ade80', textShadow: '0 0 12px #16a34a' }}>STEP TRACKER</h1>
        {streak > 1 && (
          <span className="ml-auto text-sm font-black text-orange-300" style={{ textShadow: '0 0 8px #ea580c' }}>
            🔥 {streak}-day streak
          </span>
        )}
      </div>

      {/* the ring */}
      <div className="flex justify-center mt-2 relative">
        <svg width="230" height="230" viewBox="0 0 230 230">
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4ade80" /><stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <circle cx="115" cy="115" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="16" />
          <circle cx="115" cy="115" r={R} fill="none" stroke="url(#ringGrad)" strokeWidth="16" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)}
            transform="rotate(-90 115 115)"
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)', filter: 'drop-shadow(0 0 10px rgba(74,222,128,0.5))' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-5xl">👟</span>
          <span className="font-black text-4xl tabular-nums mt-1" style={{ textShadow: '0 0 16px rgba(74,222,128,0.6)' }}>
            {shown.toLocaleString()}
          </span>
          <span className="text-white/50 text-[11px] mt-0.5">of {DAILY_GOAL.toLocaleString()} today</span>
          {pct >= 1 && <span className="text-green-300 text-xs font-black mt-0.5" style={{ textShadow: '0 0 8px #22c55e' }}>🎯 GOAL SMASHED!</span>}
        </div>
      </div>

      {/* today's FP */}
      <div className="max-w-md mx-auto px-4 mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="FP TODAY" value={`+${todayFp.toLocaleString()}`} color="#4ade80" />
        <Stat label="RATE" value="100 FP / 150" color="#fbbf24" />
        <Stat label="DAILY MAX" value="30,000" color="#67e8f9" />
      </div>

      {/* 14-day chart */}
      <div className="max-w-md mx-auto px-4 mt-5">
        <h3 className="text-white/50 text-[11px] tracking-widest mb-2">LAST 14 DAYS</h3>
        <div className="rounded-2xl p-3 pb-1" style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-end gap-1" style={{ height: 110 }}>
            {chart.map(c => (
              <div key={c.date} className="flex-1 flex flex-col items-center justify-end h-full">
                {c.steps > 0 && c.steps >= DAILY_GOAL && <span className="text-[9px] mb-0.5">⭐</span>}
                <div className="w-full rounded-t-md" style={{
                  height: `${Math.max(3, (c.steps / chartMax) * 100)}%`,
                  background: c.isToday
                    ? 'linear-gradient(180deg,#4ade80,#16a34a)'
                    : c.steps >= DAILY_GOAL ? 'linear-gradient(180deg,#22d3ee,#0e7490)' : 'rgba(255,255,255,0.18)',
                  boxShadow: c.isToday ? '0 0 10px rgba(74,222,128,0.5)' : undefined,
                  transition: 'height 0.6s cubic-bezier(.4,0,.2,1)',
                }} />
              </div>
            ))}
          </div>
          <div className="flex gap-1 mt-1">
            {chart.map(c => (
              <div key={c.date} className={`flex-1 text-center text-[9px] ${c.isToday ? 'text-green-300 font-black' : 'text-white/35'}`}>{c.label}</div>
            ))}
          </div>
        </div>
      </div>

      {/* lifetime */}
      <div className="max-w-md mx-auto px-4 mt-4 grid grid-cols-2 gap-2 text-center">
        <Stat label="LIFETIME STEPS" value={lifetime.toLocaleString()} color="#4ade80" big />
        <Stat label="MILES WALKED" value={miles} color="#22d3ee" big />
      </div>

      {/* milestones */}
      <div className="max-w-md mx-auto px-4 mt-5">
        <h3 className="text-white/50 text-[11px] tracking-widest mb-2">MILESTONES</h3>
        <div className="grid grid-cols-3 gap-2">
          {MILESTONES.map(m => {
            const done = lifetime >= m.at
            const isNext = nextMilestone?.at === m.at
            return (
              <div key={m.at} className="rounded-xl p-2.5 text-center" style={{
                background: done ? 'rgba(74,222,128,0.12)' : 'rgba(0,0,0,0.35)',
                border: `1px solid ${done ? 'rgba(74,222,128,0.45)' : 'rgba(255,255,255,0.08)'}`,
                opacity: done || isNext ? 1 : 0.45,
              }}>
                <div className="text-2xl" style={{ filter: done ? 'drop-shadow(0 0 6px rgba(74,222,128,0.8))' : 'grayscale(1)' }}>{m.emoji}</div>
                <div className={`text-[10px] font-black mt-1 ${done ? 'text-green-300' : 'text-white/60'}`}>{m.label}</div>
                <div className="text-[9px] text-white/40">{m.at.toLocaleString()}</div>
                {isNext && !done && (
                  <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (lifetime / m.at) * 100)}%`, background: 'linear-gradient(90deg,#4ade80,#22d3ee)' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <p className="text-center text-white/35 text-[11px] mt-5 px-6">
        Steps count while the app is open (screen on). Every 150 steps = 100 FP, up to 30,000 steps a day.
      </p>
    </div>
  )
}

function Stat({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }) {
  return (
    <div className="rounded-xl py-2 px-1" style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-[9px] tracking-widest text-white/45">{label}</div>
      <div className={`font-black tabular-nums ${big ? 'text-xl' : 'text-sm'}`} style={{ color }}>{value}</div>
    </div>
  )
}

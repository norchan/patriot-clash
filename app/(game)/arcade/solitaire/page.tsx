'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'

// SOLITAIRE — the classic, arcade-ified (Michael's spec: "modern version of a
// classic... more like landslide in the feel and play, streaks etc").
// Klondike draw-1, TAP-TO-MOVE (tap a card, it flies to the best spot), with:
//  - STREAK multiplier: foundation plays within 6s of each other chain
//    ×2 ×3 ×4 ×5 — the whole scoring game is keeping the chain alive
//  - landslide-style juice: neon meters, score pops, ON FIRE banner, sfx
//  - one-tap FINISH cascade when the board is proven won
// FP: 5/foundation card + 150 win bonus, arcade session + daily cap.

type Suit = '♠' | '♥' | '♦' | '♣'
interface Card { suit: Suit; rank: number; faceUp: boolean; id: number }
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const RED = new Set<Suit>(['♥', '♦'])
const RANK_TXT = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const STREAK_MS = 6000

interface GameState {
  stock: Card[]; waste: Card[]
  found: Card[][] // 4 foundations by suit index
  tab: Card[][] // 7 tableau piles
}

const deepCopy = (s: GameState): GameState => JSON.parse(JSON.stringify(s))

function deal(): GameState {
  const deck: Card[] = []
  let id = 0
  for (const suit of SUITS) for (let r = 1; r <= 13; r++) deck.push({ suit, rank: r, faceUp: false, id: id++ })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]
  }
  const tab: Card[][] = []
  for (let p = 0; p < 7; p++) {
    tab.push(deck.splice(0, p + 1))
    tab[p][tab[p].length - 1].faceUp = true
  }
  return { stock: deck, waste: [], found: [[], [], [], []], tab }
}

export default function SolitairePage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [g, setG] = useState<GameState | null>(null)
  const [phase, setPhase] = useState<'start' | 'playing' | 'won'>('start')
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0) // consecutive timed foundation plays
  const [streakPct, setStreakPct] = useState(0) // countdown bar 0..1
  const [moves, setMoves] = useState(0)
  const [secs, setSecs] = useState(0)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpToast, setFpToast] = useState('')
  const [fpGame, setFpGame] = useState(0)
  const [pop, setPop] = useState<{ txt: string; key: number; color: string } | null>(null)
  const [shakeId, setShakeId] = useState<number | null>(null)
  const [finishing, setFinishing] = useState(false)

  const undoRef = useRef<GameState[]>([])
  const lastFoundAtRef = useRef(0)
  const streakRef = useRef(0)
  const pendingCardsRef = useRef(0)
  const cappedRef = useRef(false)
  const sessionRef = useRef<string | null>(null)

  useEffect(() => { if (profile && balance === null) setBalance(profile.fp_balance) }, [profile, balance])
  useEffect(() => {
    fetch('/api/arcade/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'solitaire' }),
    }).then(r => r.json()).then(d => { sessionRef.current = d.session_id ?? null }).catch(() => {})
  }, [])

  useEffect(() => {
    if (phase !== 'playing') return
    const t = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // streak countdown bar + expiry
  useEffect(() => {
    if (phase !== 'playing') return
    const t = setInterval(() => {
      const left = Math.max(0, STREAK_MS - (Date.now() - lastFoundAtRef.current))
      setStreakPct(streakRef.current > 0 ? left / STREAK_MS : 0)
      if (streakRef.current > 0 && left === 0) { streakRef.current = 0; setStreak(0) }
    }, 120)
    return () => clearInterval(t)
  }, [phase])

  async function reward(event: 'cards' | 'win', count?: number) {
    try {
      const res = await fetch('/api/arcade/solitaire/reward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, count, session_id: sessionRef.current }),
      })
      const d = await res.json()
      if (res.ok && d.awarded > 0) {
        setFpGame(f => f + d.awarded)
        setBalance(d.balance); sfx.coin()
        setFpToast(`+${d.awarded} FP`); setTimeout(() => setFpToast(''), 1100)
      } else if (res.ok && d.capped && !cappedRef.current) {
        cappedRef.current = true
        setFpToast('🏁 Daily arcade FP cap reached — playing for glory!')
        setTimeout(() => setFpToast(''), 2600)
      }
    } catch {}
  }
  function flushCards(force = false) {
    if (pendingCardsRef.current >= 8 || (force && pendingCardsRef.current > 0)) {
      const n = pendingCardsRef.current
      pendingCardsRef.current = 0
      reward('cards', n)
    }
  }

  function start() {
    setG(deal()); setPhase('playing')
    setScore(0); setMoves(0); setSecs(0); setFpGame(0)
    setStreak(0); streakRef.current = 0; lastFoundAtRef.current = 0
    undoRef.current = []; pendingCardsRef.current = 0
    setFinishing(false)
    sfx.levelUp()
  }

  function showPop(txt: string, color = '#67e8f9') {
    setPop({ txt, key: Date.now(), color })
    setTimeout(() => setPop(p => (p && Date.now() - p.key >= 750 ? null : p)), 800)
  }

  function bumpStreak() {
    const now = Date.now()
    const chained = now - lastFoundAtRef.current <= STREAK_MS && lastFoundAtRef.current > 0
    streakRef.current = chained ? Math.min(5, streakRef.current + 1) : 1
    lastFoundAtRef.current = now
    setStreak(streakRef.current)
    const mult = streakRef.current
    const gain = 100 * mult
    setScore(s => s + gain)
    showPop(mult > 1 ? `+${gain} ×${mult}` : `+${gain}`, mult >= 4 ? '#fbbf24' : '#4ade80')
    sfx.match(Math.min(4, mult))
    pendingCardsRef.current++
    flushCards()
  }

  // ── move engine: tap a card, it goes to the best legal home ───────────────
  function canFound(c: Card, f: Card[][]) {
    const fi = SUITS.indexOf(c.suit)
    return f[fi].length === c.rank - 1 ? fi : -1
  }
  function tabTarget(c: Card, t: Card[][], excludePile: number) {
    for (let p = 0; p < 7; p++) {
      if (p === excludePile) continue
      const top = t[p][t[p].length - 1]
      if (!top && c.rank === 13) return p
      if (top && top.faceUp && top.rank === c.rank + 1 && RED.has(top.suit) !== RED.has(c.suit)) return p
    }
    return -1
  }

  function pushUndo(s: GameState) {
    undoRef.current.push(deepCopy(s))
    if (undoRef.current.length > 200) undoRef.current.shift()
  }

  function afterMove(next: GameState) {
    setMoves(m => m + 1)
    // reveal any exposed card
    for (const pile of next.tab) {
      const top = pile[pile.length - 1]
      if (top && !top.faceUp) { top.faceUp = true; setScore(s => s + 25) }
    }
    setG({ ...next })
    if (next.found.every(f => f.length === 13)) winGame()
  }

  function winGame() {
    setPhase('won'); sfx.levelUp()
    flushCards(true)
    reward('win')
    fetch('/api/arcade/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'solitaire', score: Math.max(0, 10000 - secs * 10 + score), session_id: sessionRef.current }) }).catch(() => {})
    refetch()
  }

  function tapStock() {
    if (!g || phase !== 'playing' || finishing) return
    pushUndo(g)
    const next = deepCopy(g)
    if (next.stock.length) {
      const c = next.stock.pop()!
      c.faceUp = true
      next.waste.push(c)
      sfx.swap()
    } else if (next.waste.length) {
      next.stock = next.waste.reverse().map(c => ({ ...c, faceUp: false }))
      next.waste = []
      sfx.swap()
    } else { undoRef.current.pop(); return }
    setMoves(m => m + 1)
    setG(next)
  }

  function tapWaste() {
    if (!g || phase !== 'playing' || finishing || !g.waste.length) return
    const c = g.waste[g.waste.length - 1]
    const fi = canFound(c, g.found)
    const next = deepCopy(g)
    if (fi >= 0) {
      pushUndo(g)
      next.found[fi].push(next.waste.pop()!)
      bumpStreak()
      afterMove(next)
      return
    }
    const tp = tabTarget(c, g.tab, -1)
    if (tp >= 0) {
      pushUndo(g)
      next.tab[tp].push(next.waste.pop()!)
      setScore(s => s + 5)
      sfx.swap()
      afterMove(next)
      return
    }
    setShakeId(c.id); sfx.invalid(); setTimeout(() => setShakeId(null), 350)
  }

  function tapTab(pi: number, ci: number) {
    if (!g || phase !== 'playing' || finishing) return
    const pile = g.tab[pi]
    const c = pile[ci]
    if (!c.faceUp) { if (ci === pile.length - 1) return; return }
    const run = pile.slice(ci)
    // single top card → try foundation first
    if (run.length === 1) {
      const fi = canFound(c, g.found)
      if (fi >= 0) {
        pushUndo(g)
        const next = deepCopy(g)
        next.found[fi].push(next.tab[pi].pop()!)
        bumpStreak()
        afterMove(next)
        return
      }
    }
    // run (or single) → another tableau pile
    const tp = tabTarget(c, g.tab, pi)
    if (tp >= 0) {
      pushUndo(g)
      const next = deepCopy(g)
      const moved = next.tab[pi].splice(ci)
      next.tab[tp].push(...moved)
      setScore(s => s + 5)
      sfx.swap()
      afterMove(next)
      return
    }
    setShakeId(c.id); sfx.invalid(); setTimeout(() => setShakeId(null), 350)
  }

  function undo() {
    if (!undoRef.current.length || phase !== 'playing' || finishing) return
    const prev = undoRef.current.pop()!
    setG(prev)
    setScore(s => Math.max(0, s - 40)) // undo has a price — keeps streak play honest
    sfx.invalid()
  }

  // board is proven won: nothing hidden anywhere and the stock is spent
  const canFinish = !!g && phase === 'playing' && !finishing &&
    g.stock.length === 0 && g.waste.length === 0 &&
    g.tab.every(p => p.every(c => c.faceUp)) &&
    g.tab.some(p => p.length > 0)

  function autoFinish() {
    if (!g || finishing) return
    setFinishing(true)
    sfx.levelUp()
    const iv = setInterval(() => {
      setG(cur => {
        if (!cur) return cur
        const next = deepCopy(cur)
        for (let p = 0; p < 7; p++) {
          const top = next.tab[p][next.tab[p].length - 1]
          if (!top) continue
          const fi = canFound(top, next.found)
          if (fi >= 0) {
            next.found[fi].push(next.tab[p].pop()!)
            bumpStreak()
            if (next.found.every(f => f.length === 13)) {
              clearInterval(iv)
              setTimeout(() => winGame(), 120)
            }
            return next
          }
        }
        clearInterval(iv)
        setFinishing(false)
        return cur
      })
    }, 130)
  }

  // ── render ────────────────────────────────────────────────────────────────
  const cardFace = (c: Card, small = false) => (
    <div className={`w-full h-full rounded-[7px] flex flex-col justify-between select-none ${small ? 'p-[3px]' : 'p-1'}`}
      style={{
        background: 'linear-gradient(160deg,#f8fafc,#e2e8f0)',
        border: '1px solid #94a3b8',
        color: RED.has(c.suit) ? '#dc2626' : '#0f172a',
        boxShadow: '0 2px 5px rgba(0,0,0,0.45)',
      }}>
      <div className="leading-none font-black" style={{ fontSize: small ? 11 : 13 }}>{RANK_TXT[c.rank]}<span style={{ fontSize: small ? 9 : 11 }}>{c.suit}</span></div>
      <div className="text-center leading-none" style={{ fontSize: small ? 14 : 20, opacity: 0.9 }}>{c.suit}</div>
    </div>
  )
  const cardBack = (
    <div className="w-full h-full rounded-[7px]"
      style={{
        background: 'repeating-linear-gradient(45deg,#4c1d95,#4c1d95 4px,#5b21b6 4px,#5b21b6 8px)',
        border: '1px solid #7c3aed', boxShadow: '0 2px 5px rgba(0,0,0,0.45)',
      }} />
  )

  const CW = 'calc((100% - 18px) / 7)' // 7 columns, 3px gaps

  return (
    <div className="min-h-screen text-white relative select-none pb-10"
      style={{ background: 'radial-gradient(circle at 50% 0%, #14532d, #0c2919 55%, #071711)', fontFamily: 'ui-monospace, monospace' }}>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.push('/arcade')} className="text-white/70 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.12em] text-lg" style={{ color: '#4ade80', textShadow: '0 0 12px #16a34a, 0 2px 0 #000' }}>SOLITAIRE</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {(balance ?? 0).toLocaleString()}</span>
      </div>

      <div className="max-w-md mx-auto px-4 flex items-center justify-between text-[13px] font-black">
        <span style={{ color: '#67e8f9' }}>SCORE {score.toLocaleString()}</span>
        <span className={streak >= 4 ? 'text-amber-300' : 'text-white/80'}
          style={{ animation: streak >= 4 ? 'meterPulse 0.8s ease-in-out infinite' : undefined }}>
          {streak > 1 ? `🔥 ×${streak}` : 'STREAK —'}
        </span>
        <span className="text-white/70">⏱ {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      </div>
      {/* streak countdown bar */}
      <div className="max-w-md mx-auto px-4 mt-1">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div className="h-full rounded-full" style={{
            width: `${streakPct * 100}%`,
            background: streak >= 4 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#16a34a,#4ade80)',
            transition: 'width 120ms linear',
          }} />
        </div>
      </div>

      <div className="max-w-md mx-auto px-3 mt-2 relative">
        {/* top row: stock · waste · (gap) · foundations */}
        {g && (
          <div className="flex gap-[3px] mb-2">
            <div style={{ width: CW }} className="aspect-[5/7] relative cursor-pointer" onPointerDown={tapStock}>
              {g.stock.length ? cardBack : (
                <div className="w-full h-full rounded-[7px] flex items-center justify-center text-white/40 text-lg"
                  style={{ border: '2px dashed rgba(255,255,255,0.22)' }}>↻</div>
              )}
              {g.stock.length > 0 && <span className="absolute -bottom-4 inset-x-0 text-center text-[9px] text-white/45 font-bold">{g.stock.length}</span>}
            </div>
            <div style={{ width: CW }} className="aspect-[5/7] relative cursor-pointer" onPointerDown={tapWaste}>
              {g.waste.length ? (
                <div className="w-full h-full" style={{ animation: shakeId === g.waste[g.waste.length - 1].id ? 'cardShake 0.35s ease' : undefined }}>
                  {cardFace(g.waste[g.waste.length - 1])}
                </div>
              ) : (
                <div className="w-full h-full rounded-[7px]" style={{ border: '2px dashed rgba(255,255,255,0.12)' }} />
              )}
            </div>
            <div style={{ width: CW }} />
            {g.found.map((f, i) => (
              <div key={i} style={{ width: CW }} className="aspect-[5/7]">
                {f.length ? cardFace(f[f.length - 1]) : (
                  <div className="w-full h-full rounded-[7px] flex items-center justify-center text-lg"
                    style={{ border: '2px dashed rgba(255,255,255,0.18)', color: RED.has(SUITS[i]) ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.3)' }}>
                    {SUITS[i]}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* tableau */}
        {g && (
          <div className="flex gap-[3px] items-start" style={{ minHeight: 380 }}>
            {g.tab.map((pile, pi) => (
              <div key={pi} style={{ width: CW }} className="relative">
                {!pile.length && <div className="aspect-[5/7] rounded-[7px]" style={{ border: '2px dashed rgba(255,255,255,0.12)' }} />}
                {pile.map((c, ci) => {
                  const top = pile.slice(0, ci).reduce((y, cc) => y + (cc.faceUp ? 24 : 9), 0)
                  return (
                    <div key={c.id} onPointerDown={() => tapTab(pi, ci)}
                      className="absolute left-0 right-0 aspect-[5/7] cursor-pointer"
                      style={{ top, zIndex: ci + 1, animation: shakeId === c.id ? 'cardShake 0.35s ease' : undefined }}>
                      {c.faceUp ? cardFace(c, true) : cardBack}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* floating score pop + fp toast */}
        {pop && (
          <div key={pop.key} className="absolute top-24 left-1/2 -translate-x-1/2 font-black text-2xl pointer-events-none z-30 whitespace-nowrap"
            style={{ color: pop.color, textShadow: `0 0 12px ${pop.color}, 0 2px 4px #000`, animation: 'popFloat 0.8s ease-out forwards' }}>
            {pop.txt}
          </div>
        )}
        {fpToast && (
          <div className="absolute top-36 left-1/2 -translate-x-1/2 text-green-300 font-black text-xl pointer-events-none z-30 whitespace-nowrap"
            style={{ textShadow: '0 0 10px #22c55e, 0 2px 4px #000' }}>{fpToast}</div>
        )}
        {streak >= 4 && phase === 'playing' && (
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 font-black text-sm text-amber-300 pointer-events-none z-30"
            style={{ textShadow: '0 0 12px #f59e0b', animation: 'meterPulse 0.7s ease-in-out infinite' }}>
            🔥 ON FIRE 🔥
          </div>
        )}

        {/* start / win overlay */}
        {phase !== 'playing' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl px-6 -mx-1"
            style={{ background: 'rgba(4,16,10,0.86)', backdropFilter: 'blur(3px)', minHeight: 420 }}>
            <div className="text-center w-full">
              {phase === 'start' && <>
                <h2 className="text-3xl font-black" style={{ color: '#4ade80', textShadow: '0 0 16px #16a34a' }}>SOLITAIRE</h2>
                <p className="text-white/70 text-sm mt-2">The classic — arcade rules. TAP any card and it flies to the right spot. Chain foundation plays within 6 seconds to build a 🔥 streak: ×2 ×3 ×4 ×5 scoring.</p>
                <p className="text-white/50 text-xs mt-1.5">5 FP per card home · 150 FP for the win</p>
                <button onClick={start} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#4ade80,#15803d)' }}>▶ DEAL</button>
              </>}
              {phase === 'won' && <>
                <h2 className="text-3xl font-black text-amber-300" style={{ textShadow: '0 0 16px #f59e0b' }}>🏆 CLEARED!</h2>
                <p className="text-white/60 text-xs mt-1">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} · {moves} moves · {score.toLocaleString()} pts · +{fpGame} FP</p>
                <button onClick={start} className="w-full mt-5 py-3.5 rounded-xl font-black text-lg"
                  style={{ background: 'radial-gradient(circle at 50% 30%,#4ade80,#15803d)' }}>▶ DEAL AGAIN</button>
              </>}
            </div>
          </div>
        )}
      </div>

      {/* bottom controls */}
      {phase === 'playing' && (
        <div className="max-w-md mx-auto px-4 mt-3 flex items-center gap-2">
          <button onClick={undo} disabled={!undoRef.current.length || finishing}
            className="flex-1 py-2.5 rounded-full font-black text-[13px] transition active:scale-95 disabled:opacity-35"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.18)' }}>
            ↶ UNDO (−40 pts)
          </button>
          {canFinish && (
            <button onClick={autoFinish}
              className="flex-1 py-2.5 rounded-full font-black text-[13px] transition active:scale-95"
              style={{ background: 'radial-gradient(circle at 50% 30%,#fbbf24,#b45309)', color: '#111', animation: 'meterPulse 0.8s ease-in-out infinite' }}>
              ⚡ FINISH
            </button>
          )}
          <button onClick={start} disabled={finishing}
            className="flex-1 py-2.5 rounded-full font-black text-[13px] transition active:scale-95 disabled:opacity-35"
            style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.35)' }}>
            ↻ NEW DEAL
          </button>
        </div>
      )}

      <style>{`
        @keyframes popFloat { 0% { opacity: 1; transform: translate(-50%, 0) scale(0.7) } 30% { transform: translate(-50%, -8px) scale(1.15) } 100% { opacity: 0; transform: translate(-50%, -42px) scale(1) } }
        @keyframes cardShake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) } 50% { transform: translateX(5px) } 75% { transform: translateX(-3px) } }
        @keyframes meterPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.08) } }
      `}</style>
    </div>
  )
}

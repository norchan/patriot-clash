'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import * as sfx from '@/lib/match3-sfx'

// SOLITAIRE — the classic, arcade-ified (Michael's spec: "modern version of a
// classic... more like landslide in the feel and play, streaks etc").
// Klondike draw-1, DRAG-AND-DROP (Michael: pick a card up and move it to the
// correct spot yourself — no auto-placing), with:
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
const FAN_UP = 30   // vertical reveal of a face-up card stacked in a tableau pile
const FAN_DOWN = 11 // ...of a face-down card

interface DropTarget { kind: 'found' | 'tab'; idx: number; valid: boolean }
interface DragState {
  from: 'waste' | 'tab'
  pi?: number; ci?: number   // tableau source pile / card index
  cards: Card[]              // the run being carried (1+ cards)
  w: number; h: number       // measured card size
  offX: number; offY: number // pointer offset within the grabbed card
  sx: number; sy: number     // where the gesture started (tap vs drag)
  x: number; y: number       // current pointer position
  hover: DropTarget | null
}

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
  const [finishing, setFinishing] = useState(false)

  const undoRef = useRef<GameState[]>([])
  const lastFoundAtRef = useRef(0)
  const streakRef = useRef(0)
  const pendingCardsRef = useRef(0)
  const cappedRef = useRef(false)
  const sessionRef = useRef<string | null>(null)

  // drag-and-drop plumbing
  const gRef = useRef<GameState | null>(null)
  const secsRef = useRef(0)
  const colRefs = useRef<(HTMLDivElement | null)[]>([])   // 7 tableau drop zones
  const foundRefs = useRef<(HTMLDivElement | null)[]>([]) // 4 foundation drop zones
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const hitTestRef = useRef<(x: number, y: number, d: DragState) => DropTarget | null>(() => null)
  const commitRef = useRef<(d: DragState, t: DropTarget) => void>(() => {})

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

  useEffect(() => { gRef.current = g }, [g])
  useEffect(() => { secsRef.current = secs }, [secs])

  // ONE global drag gesture: once a card is picked up, pointer moves/releases
  // anywhere on screen drive it (touch + mouse). Reads the live board via refs
  // so the mount-time listeners always see the current state.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()
      d.x = e.clientX; d.y = e.clientY
      d.hover = hitTestRef.current(e.clientX, e.clientY, d)
      setDrag({ ...d })
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      const t = hitTestRef.current(e.clientX, e.clientY, d)
      setDrag(null)
      if (t && t.valid) commitRef.current(d, t)
      else if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) sfx.invalid() // real drag that missed → snap-back buzz
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

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

  // ── move rules ────────────────────────────────────────────────────────────
  function canFound(c: Card, f: Card[][]) {
    const fi = SUITS.indexOf(c.suit)
    return f[fi].length === c.rank - 1 ? fi : -1
  }
  // may this card sit on this tableau pile? (empty pile takes only a King)
  function canPlaceTab(c: Card, pile: Card[]) {
    const top = pile[pile.length - 1]
    if (!top) return c.rank === 13
    return top.faceUp && top.rank === c.rank + 1 && RED.has(top.suit) !== RED.has(c.suit)
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
    fetch('/api/arcade/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'solitaire', score: Math.max(0, 10000 - secsRef.current * 10 + score), session_id: sessionRef.current }) }).catch(() => {})
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

  // DOUBLE-TAP → send the card to its foundation if it fits (Michael).
  // Single taps/holds still drag — this only fires on a quick second tap on
  // the SAME card, and only the exposed top card of a pile can fly up.
  const lastTapRef = useRef<{ key: string; at: number }>({ key: '', at: 0 })
  function tryAutoFound(from: 'waste' | 'tab', pi?: number, ci?: number) {
    const cur = gRef.current
    if (!cur || phase !== 'playing' || finishing) return
    let card: Card | undefined
    if (from === 'waste') {
      card = cur.waste[cur.waste.length - 1]
    } else {
      const pile = cur.tab[pi!]
      if (!pile || ci !== pile.length - 1) return // buried cards can't go up
      card = pile[ci!]
      if (card && !card.faceUp) return
    }
    if (!card) return
    const fi = canFound(card, cur.found)
    if (fi < 0) { sfx.invalid(); return } // doesn't fit — soft no
    pushUndo(cur)
    const next = deepCopy(cur)
    next.found[fi].push((from === 'waste' ? next.waste : next.tab[pi!]).pop()!)
    bumpStreak()
    afterMove(next)
  }

  // pick up the top waste card, or a face-up card + everything stacked on it
  function startDrag(from: 'waste' | 'tab', e: React.PointerEvent, pi?: number, ci?: number) {
    if (!g || phase !== 'playing' || finishing) return
    // second quick tap on the same card = auto-foundation attempt, not a drag
    const tapKey = from === 'waste' ? 'waste' : `t${pi}-${ci}`
    const now = Date.now()
    if (lastTapRef.current.key === tapKey && now - lastTapRef.current.at < 350) {
      lastTapRef.current = { key: '', at: 0 }
      dragRef.current = null
      setDrag(null)
      tryAutoFound(from, pi, ci)
      return
    }
    lastTapRef.current = { key: tapKey, at: now }
    let cards: Card[]
    if (from === 'waste') {
      if (!g.waste.length) return
      cards = [g.waste[g.waste.length - 1]]
    } else {
      const pile = g.tab[pi!]
      const c = pile[ci!]
      if (!c.faceUp) return // can't grab a face-down card
      cards = pile.slice(ci!)
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const st: DragState = {
      from, pi, ci, cards,
      w: rect.width, h: rect.height,
      offX: e.clientX - rect.left, offY: e.clientY - rect.top,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, hover: null,
    }
    dragRef.current = st
    setDrag(st)
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

  // which drop zone is the pointer over, and is the move legal? (refreshed
  // every render so the mount-effect gesture reads the current board)
  hitTestRef.current = (x, y, d) => {
    const gg = gRef.current
    if (!gg) return null
    const grabbed = d.cards[0]
    for (let i = 0; i < 4; i++) {
      const r = foundRefs.current[i]?.getBoundingClientRect()
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { kind: 'found', idx: i, valid: d.cards.length === 1 && canFound(grabbed, gg.found) === i }
      }
    }
    for (let p = 0; p < 7; p++) {
      const r = colRefs.current[p]?.getBoundingClientRect()
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const sameSource = d.from === 'tab' && d.pi === p
        return { kind: 'tab', idx: p, valid: !sameSource && canPlaceTab(grabbed, gg.tab[p]) }
      }
    }
    return null
  }
  commitRef.current = (d, t) => {
    const gg = gRef.current
    if (!gg) return
    pushUndo(gg)
    const next = deepCopy(gg)
    if (t.kind === 'found') {
      if (d.from === 'waste') next.waste.pop()
      else next.tab[d.pi!].splice(d.ci!)
      next.found[t.idx].push(d.cards[0])
      bumpStreak()
      afterMove(next)
    } else {
      if (d.from === 'waste') { const c = next.waste.pop()!; next.tab[t.idx].push(c) }
      else { const moved = next.tab[d.pi!].splice(d.ci!); next.tab[t.idx].push(...moved) }
      setScore(s => s + 5)
      sfx.swap()
      afterMove(next)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  const cardFace = (c: Card, small = false) => (
    <div className={`w-full h-full rounded-[7px] flex flex-col justify-between select-none ${small ? 'px-[3px] pt-[2px] pb-[3px]' : 'p-1'}`}
      style={{
        background: 'linear-gradient(160deg,#f8fafc,#e2e8f0)',
        border: '1px solid #94a3b8',
        color: RED.has(c.suit) ? '#dc2626' : '#0f172a',
        boxShadow: '0 2px 5px rgba(0,0,0,0.45)',
      }}>
      <div className="leading-none font-black flex items-baseline gap-[1px]" style={{ fontSize: small ? 19 : 22 }}>
        {RANK_TXT[c.rank]}<span style={{ fontSize: small ? 15 : 18 }}>{c.suit}</span>
      </div>
      <div className="text-center leading-none" style={{ fontSize: small ? 24 : 30, opacity: 0.92 }}>{c.suit}</div>
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

      <div className="max-w-lg mx-auto px-4 flex items-center justify-between text-[13px] font-black">
        <span style={{ color: '#67e8f9' }}>SCORE {score.toLocaleString()}</span>
        <span className={streak >= 4 ? 'text-amber-300' : 'text-white/80'}
          style={{ animation: streak >= 4 ? 'meterPulse 0.8s ease-in-out infinite' : undefined }}>
          {streak > 1 ? `🔥 ×${streak}` : 'STREAK —'}
        </span>
        <span className="text-white/70">⏱ {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      </div>
      {/* streak countdown bar */}
      <div className="max-w-lg mx-auto px-4 mt-1">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div className="h-full rounded-full" style={{
            width: `${streakPct * 100}%`,
            background: streak >= 4 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#16a34a,#4ade80)',
            transition: 'width 120ms linear',
          }} />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-3 mt-2 relative">
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
            <div style={{ width: CW, touchAction: 'none' }} className="aspect-[5/7] relative cursor-grab"
              onPointerDown={(e) => startDrag('waste', e)}>
              {g.waste.length && drag?.from !== 'waste' ? (
                <div className="w-full h-full">{cardFace(g.waste[g.waste.length - 1])}</div>
              ) : (
                <div className="w-full h-full rounded-[7px]" style={{ border: '2px dashed rgba(255,255,255,0.12)' }} />
              )}
            </div>
            <div style={{ width: CW }} />
            {g.found.map((f, i) => {
              const hov = drag?.hover?.kind === 'found' && drag.hover.idx === i
              return (
                <div key={i} ref={el => { foundRefs.current[i] = el }} style={{ width: CW }} className="aspect-[5/7] relative">
                  {f.length ? cardFace(f[f.length - 1]) : (
                    <div className="w-full h-full rounded-[7px] flex items-center justify-center text-lg"
                      style={{ border: '2px dashed rgba(255,255,255,0.18)', color: RED.has(SUITS[i]) ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.3)' }}>
                      {SUITS[i]}
                    </div>
                  )}
                  {hov && (
                    <div className="absolute inset-0 rounded-[8px] pointer-events-none"
                      style={{ boxShadow: `0 0 0 3px ${drag!.hover!.valid ? '#4ade80' : '#ef4444'}`, zIndex: 5 }} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* tableau */}
        {g && (
          <div className="flex gap-[3px] items-start" style={{ minHeight: 460 }}>
            {g.tab.map((pile, pi) => {
              const hov = drag?.hover?.kind === 'tab' && drag.hover.idx === pi
              // cards being carried are hidden from their source pile
              const hideFrom = drag?.from === 'tab' && drag.pi === pi ? drag.ci! : Infinity
              return (
                <div key={pi} ref={el => { colRefs.current[pi] = el }} style={{ width: CW, minHeight: 440 }} className="relative">
                  {!pile.length && <div className="aspect-[5/7] rounded-[7px]" style={{ border: '2px dashed rgba(255,255,255,0.12)' }} />}
                  {pile.map((c, ci) => {
                    if (ci >= hideFrom) return null
                    // more reveal per card now that the ranks are bigger, so a
                    // stacked card's number is never clipped by the one on top
                    const top = pile.slice(0, ci).reduce((y, cc) => y + (cc.faceUp ? FAN_UP : FAN_DOWN), 0)
                    return (
                      <div key={c.id} onPointerDown={(e) => startDrag('tab', e, pi, ci)}
                        className={`absolute left-0 right-0 aspect-[5/7] ${c.faceUp ? 'cursor-grab' : ''}`}
                        style={{ top, zIndex: ci + 1, touchAction: 'none' }}>
                        {c.faceUp ? cardFace(c, true) : cardBack}
                      </div>
                    )
                  })}
                  {hov && (
                    <div className="absolute inset-x-0 top-0 rounded-[8px] pointer-events-none"
                      style={{ height: 452, boxShadow: `inset 0 0 0 3px ${drag!.hover!.valid ? '#4ade80' : '#ef4444'}`, zIndex: 40 }} />
                  )}
                </div>
              )
            })}
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
                <p className="text-white/70 text-sm mt-2">The classic — arcade rules. Press and drag a card (or a run) to where it goes, and drop it. Chain foundation plays within 6 seconds to build a 🔥 streak: ×2 ×3 ×4 ×5 scoring.</p>
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
        <div className="max-w-lg mx-auto px-4 mt-3 flex items-center gap-2">
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

      {/* the carried card(s) — follows the pointer, tilted like a real lift */}
      {drag && (
        <div className="fixed z-50 pointer-events-none"
          style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.w, transform: 'rotate(3deg)' }}>
          {drag.cards.map((c, i) => (
            <div key={c.id} className="absolute left-0 aspect-[5/7]"
              style={{ top: i * FAN_UP, width: '100%', filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.55))' }}>
              {cardFace(c, true)}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes popFloat { 0% { opacity: 1; transform: translate(-50%, 0) scale(0.7) } 30% { transform: translate(-50%, -8px) scale(1.15) } 100% { opacity: 0; transform: translate(-50%, -42px) scale(1) } }
        @keyframes meterPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.08) } }
      `}</style>
    </div>
  )
}

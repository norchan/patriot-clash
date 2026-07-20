'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Chess, type Square } from 'chess.js'
import { useProfile } from '@/hooks/useProfile'
import { validPuzzleMoves, bestDefense } from '@/lib/chess-mate'
import * as sfx from '@/lib/match3-sfx'
import PUZZLES from '@/config/chess-puzzles.json'

// Checkmate Chamber — chess puzzles: mate in 1, 2 or 3. The bank is generated
// offline and verified by the same solver used here, so ANY move that still
// forces mate inside the budget counts as correct (not just one scripted line).
// Board: classic wood + Cburnett pieces (public/chess/pieces).

type Puzzle = { fen: string; depth: 1 | 2 | 3; line: string[] }
const BANK = PUZZLES as Puzzle[]

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const LIGHT = '#f0d9b5', DARK = '#b58863'
const HL_FROM = 'rgba(155,199,0,0.45)', HL_TO = 'rgba(155,199,0,0.55)'
const pieceImg = (color: string, type: string) => `/chess/pieces/${color}${type}.svg`

const BASE_FP = { 1: 40, 2: 80, 3: 150 } as const
const DEPTH_LABEL = { 1: 'MATE IN 1', 2: 'MATE IN 2', 3: 'MATE IN 3' } as const

export default function ChessPuzzlesPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()

  const [idx, setIdx] = useState<number | null>(null) // puzzle index
  const [fen, setFen] = useState<string | null>(null) // live position
  const [movesLeft, setMovesLeft] = useState(1)
  const [sel, setSel] = useState<Square | null>(null)
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null)
  const [wrongTries, setWrongTries] = useState(0)
  const [shake, setShake] = useState(0)
  const [thinking, setThinking] = useState(false)
  const [solved, setSolved] = useState(false)
  const [failedOut, setFailedOut] = useState(false)
  const [hint, setHint] = useState<Square | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [fpToast, setFpToast] = useState('')
  const [streak, setStreak] = useState(0)
  const solvedCountRef = useRef(0)

  useEffect(() => { if (profile && balance === null) setBalance(profile.fp_balance) }, [profile, balance])

  // resume where they left off
  useEffect(() => {
    const s = parseInt(localStorage.getItem('chess_puzzle_idx') || '0', 10)
    setIdx(isNaN(s) ? 0 : Math.max(0, Math.min(BANK.length - 1, s)))
  }, [])

  const sessionRef = useRef<string | null>(null)
  const cappedRef = useRef(false)
  useEffect(() => {
    fetch('/api/arcade/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'chess' }),
    }).then(r => r.json()).then(d => { sessionRef.current = d.session_id ?? null }).catch(() => {})
  }, [])

  const puzzle = idx === null ? null : BANK[idx % BANK.length]
  const chess = useMemo(() => (fen ? new Chess(fen) : null), [fen])
  const playerColor = useMemo(() => (puzzle ? new Chess(puzzle.fen).turn() : 'w'), [puzzle])
  const flipped = playerColor === 'b' // player always looks up the board

  // (re)load current puzzle
  useEffect(() => {
    if (!puzzle) return
    setFen(puzzle.fen); setMovesLeft(puzzle.depth)
    setSel(null); setLastMove(null); setWrongTries(0); setSolved(false); setFailedOut(false); setHint(null)
  }, [idx]) // eslint-disable-line react-hooks/exhaustive-deps

  async function reward(depth: number, tries: number) {
    try {
      const res = await fetch('/api/arcade/chess/reward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth, tries, session_id: sessionRef.current }),
      })
      const d = await res.json()
      if (res.ok && d.awarded > 0) {
        setBalance(d.balance); sfx.coin()
        setFpToast(`+${d.awarded} FP`); setTimeout(() => setFpToast(''), 1400)
      } else if (res.ok && d.capped && !cappedRef.current) {
        cappedRef.current = true
        setFpToast('🏁 Daily arcade FP cap reached — playing for glory!')
        setTimeout(() => setFpToast(''), 2600)
      }
      refetch()
    } catch {}
  }

  function squareAt(r: number, c: number): Square {
    const file = flipped ? FILES[7 - c] : FILES[c]
    const rank = flipped ? r + 1 : 8 - r
    return `${file}${rank}` as Square
  }

  const legalTargets = useMemo(() => {
    if (!chess || !sel) return new Set<string>()
    return new Set(chess.moves({ square: sel, verbose: true }).map(m => m.to))
  }, [chess, sel])

  function tapSquare(sq: Square) {
    if (!chess || solved || failedOut || thinking) return
    const piece = chess.get(sq)
    if (sel && legalTargets.has(sq)) { attempt(sel, sq); return }
    if (piece && piece.color === playerColor) { setSel(sq === sel ? null : sq); return }
    setSel(null)
  }

  function attempt(from: Square, to: Square) {
    if (!chess || !fen || !puzzle) return
    setSel(null)
    const verbose = chess.moves({ square: from, verbose: true }).filter(m => m.to === to)
    if (!verbose.length) return
    // auto-queen promotions (puzzle bank has no underpromotion-only mates)
    const san = (verbose.find(m => !m.promotion || m.promotion === 'q') ?? verbose[0]).san
    const valid = validPuzzleMoves(fen, movesLeft)
    if (!valid.includes(san)) {
      setWrongTries(t => t + 1); setShake(s => s + 1); sfx.invalid()
      if (wrongTries + 1 >= 3) { setFailedOut(true); setStreak(0); sfx.gameOver() }
      return
    }
    // correct — play it
    const c = new Chess(fen)
    const played = c.move(san)
    setLastMove({ from: played.from as Square, to: played.to as Square })
    setFen(c.fen()); setHint(null)
    sfx.swap()
    if (c.isCheckmate()) { finish() ; return }
    // opponent's most resistant defense, after a beat
    setThinking(true)
    setTimeout(() => {
      const d = bestDefense(c.fen())
      if (d) {
        const dm = c.move(d)
        setLastMove({ from: dm.from as Square, to: dm.to as Square })
        setFen(c.fen())
      }
      setMovesLeft(n => n - 1)
      setThinking(false)
    }, 550)
  }

  function finish() {
    setSolved(true); setStreak(s => { const n = s + 1; fetch('/api/arcade/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'chess', score: n, session_id: sessionRef.current }) }).catch(() => {}); return n }); sfx.levelUp()
    solvedCountRef.current += 1
    if (puzzle) reward(puzzle.depth, wrongTries)
  }

  function next() {
    if (idx === null) return
    const n = (idx + 1) % BANK.length
    localStorage.setItem('chess_puzzle_idx', String(n))
    setIdx(n)
  }
  function retry() {
    if (!puzzle) return
    setFen(puzzle.fen); setMovesLeft(puzzle.depth)
    setSel(null); setLastMove(null); setWrongTries(0); setFailedOut(false); setHint(null)
  }
  function showHint() {
    if (!fen || !chess) return
    const valid = validPuzzleMoves(fen, movesLeft)
    if (!valid.length) return
    const m = chess.moves({ verbose: true }).find(v => v.san === valid[0])
    if (m) { setHint(m.from as Square); sfx.swap() }
  }

  if (!puzzle || !chess) return <div className="min-h-screen bg-[#1a120b]" />

  const inCheckSq: Square | null = chess.inCheck()
    ? (chess.board().flat().find(p => p && p.type === 'k' && p.color === chess.turn())?.square as Square ?? null)
    : null

  return (
    <div className="min-h-screen text-white relative select-none"
      style={{ background: 'radial-gradient(circle at 50% 0%, #3d2b1c, #1a120b 55%, #0d0906)', fontFamily: 'Georgia, "Times New Roman", serif' }}>
      {/* header */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.push('/arcade')} className="text-white/70 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-black tracking-[0.14em] text-lg" style={{ color: '#f5deb3', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>CHECKMATE CHAMBER</h1>
        <span className="ml-auto text-yellow-300 text-sm font-black" style={{ fontFamily: 'ui-monospace, monospace' }}>💰 {(balance ?? 0).toLocaleString()}</span>
      </div>

      {/* puzzle banner */}
      <div className="max-w-md mx-auto px-4 flex items-center justify-between">
        <div className="text-[13px] font-bold tracking-widest" style={{ color: '#f5deb3' }}>
          ♟ PUZZLE {idx! + 1}<span className="text-white/40"> / {BANK.length}</span>
        </div>
        <div className="text-[13px] font-black tracking-widest px-3 py-1 rounded-full"
          style={{ background: 'rgba(245,222,179,0.12)', color: '#ffd700', border: '1px solid rgba(255,215,0,0.35)' }}>
          {DEPTH_LABEL[puzzle.depth]}
        </div>
        {streak > 1 && <div className="text-[12px] font-black text-orange-300">🔥 {streak}</div>}
      </div>
      <p className="max-w-md mx-auto px-4 mt-1 text-[12px] text-white/60">
        {playerColor === 'w' ? 'White' : 'Black'} to move — force checkmate in {puzzle.depth} {puzzle.depth === 1 ? 'move' : 'moves'}.
        {movesLeft < puzzle.depth && !solved && ` ${movesLeft} to go.`}
      </p>

      {/* board */}
      <div className="flex justify-center mt-3 px-3">
        <div key={shake} className="rounded-lg overflow-hidden relative"
          style={{
            width: 'min(94vw, 420px)', aspectRatio: '1',
            border: '10px solid #4a3220',
            boxShadow: '0 14px 50px rgba(0,0,0,0.75), inset 0 0 0 2px #2a1c10, 0 0 0 1px #000',
            animation: shake ? 'boardShake 0.35s ease' : undefined,
          }}>
          <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
            {Array.from({ length: 64 }, (_, i) => {
              const r = Math.floor(i / 8), c = i % 8
              const sq = squareAt(r, c)
              const dark = (r + c) % 2 === 1
              const piece = chess.get(sq)
              const isSel = sel === sq
              const isLastFrom = lastMove?.from === sq, isLastTo = lastMove?.to === sq
              const isTarget = legalTargets.has(sq)
              const isHint = hint === sq
              const isCheck = inCheckSq === sq
              return (
                <button key={sq} onPointerDown={() => tapSquare(sq)} className="relative"
                  style={{ background: dark ? DARK : LIGHT }}>
                  {(isLastFrom || isLastTo) && <div className="absolute inset-0" style={{ background: isLastTo ? HL_TO : HL_FROM }} />}
                  {isSel && <div className="absolute inset-0" style={{ background: 'rgba(20,85,30,0.5)' }} />}
                  {isCheck && <div className="absolute inset-0" style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.8), rgba(220,38,38,0.15) 70%)' }} />}
                  {isHint && <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 0 4px #ffd700', animation: 'hintPulse 0.9s ease-in-out infinite' }} />}
                  {/* coordinates on edge squares */}
                  {c === 0 && <span className="absolute top-0.5 left-1 text-[9px] font-bold" style={{ color: dark ? LIGHT : DARK }}>{flipped ? r + 1 : 8 - r}</span>}
                  {r === 7 && <span className="absolute bottom-0 right-1 text-[9px] font-bold" style={{ color: dark ? LIGHT : DARK }}>{flipped ? FILES[7 - c] : FILES[c]}</span>}
                  {piece && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pieceImg(piece.color, piece.type)} alt="" draggable={false}
                      className="absolute inset-0 w-full h-full p-[4%]"
                      style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.4))', transform: isSel ? 'scale(1.12)' : undefined, transition: 'transform 0.1s' }} />
                  )}
                  {isTarget && !piece && <div className="absolute rounded-full" style={{ inset: '36%', background: 'rgba(20,85,30,0.45)' }} />}
                  {isTarget && piece && <div className="absolute inset-0 rounded-sm" style={{ boxShadow: 'inset 0 0 0 4px rgba(20,85,30,0.55)' }} />}
                </button>
              )
            })}
          </div>
          {fpToast && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-green-300 font-black text-xl pointer-events-none z-30 whitespace-nowrap"
              style={{ textShadow: '0 0 10px #22c55e, 0 2px 4px #000', fontFamily: 'ui-monospace, monospace' }}>{fpToast}</div>
          )}
        </div>
      </div>

      {/* status row */}
      <div className="max-w-md mx-auto px-4 mt-3 flex items-center justify-between">
        <div className="text-[12px] text-white/50">
          {wrongTries > 0 && !solved && !failedOut && <span className="text-red-300 font-bold">{3 - wrongTries} {3 - wrongTries === 1 ? 'try' : 'tries'} left</span>}
          {thinking && <span className="text-white/60 italic"> opponent thinking…</span>}
        </div>
        {!solved && !failedOut && (
          <button onClick={showHint} className="text-[12px] font-bold px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(255,215,0,0.12)', color: '#ffd700', border: '1px solid rgba(255,215,0,0.3)' }}>
            💡 HINT
          </button>
        )}
      </div>

      {/* solved / failed overlays */}
      {(solved || failedOut) && (
        <div className="max-w-md mx-auto px-4 mt-3">
          <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(0,0,0,0.45)', border: `1px solid ${solved ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
            {solved ? (
              <>
                <div className="text-2xl font-black" style={{ color: '#4ade80', textShadow: '0 0 14px #22c55e' }}>♛ CHECKMATE!</div>
                <p className="text-white/60 text-xs mt-1">
                  {wrongTries === 0 ? 'Flawless — full FP.' : `Solved with ${wrongTries} wrong ${wrongTries === 1 ? 'try' : 'tries'}.`}
                </p>
                <button onClick={next} className="w-full mt-3 py-3 rounded-xl font-black text-base"
                  style={{ background: 'linear-gradient(135deg,#b45309,#78350f)', border: '1px solid rgba(255,215,0,0.4)', color: '#ffd700' }}>
                  NEXT PUZZLE ▶
                </button>
              </>
            ) : (
              <>
                <div className="text-2xl font-black text-red-400">3 STRIKES</div>
                <p className="text-white/60 text-xs mt-1">The solution started with <b className="text-yellow-300">{puzzle.line[0]}</b>.</p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={retry} className="py-3 rounded-xl font-black text-sm bg-white/10">↻ RETRY (no FP)</button>
                  <button onClick={next} className="py-3 rounded-xl font-black text-sm"
                    style={{ background: 'linear-gradient(135deg,#b45309,#78350f)', color: '#ffd700' }}>SKIP ▶</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <p className="text-center text-white/40 text-[11px] mt-4 pb-8" style={{ fontFamily: 'ui-monospace, monospace' }}>
        Mate in 1 · 40 FP — Mate in 2 · 80 FP — Mate in 3 · 150 FP · wrong tries cut the reward
      </p>

      <style>{`
        @keyframes boardShake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-7px) } 50% { transform: translateX(6px) } 75% { transform: translateX(-3px) } }
        @keyframes hintPulse { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }
      `}</style>
    </div>
  )
}

import { describe, it, expect } from 'vitest'
import { matingMoves, forcesMateIn, validPuzzleMoves, bestDefense } from '@/lib/chess-mate'
import { Chess } from 'chess.js'
import PUZZLES from '@/config/chess-puzzles.json'

type Puzzle = { fen: string; depth: 1 | 2 | 3; line: string[] }
const BANK = PUZZLES as Puzzle[]

describe('chess mate solver', () => {
  it('finds a back-rank mate in 1', () => {
    expect(matingMoves('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1')).toContain('Ra8#')
  })
  it('does not hallucinate mate where there is none', () => {
    const start = new Chess().fen()
    expect(matingMoves(start)).toHaveLength(0)
    expect(forcesMateIn(start, 2)).toBe(false)
  })
})

describe('puzzle bank', () => {
  it('has all three depths', () => {
    for (const d of [1, 2, 3]) expect(BANK.some(p => p.depth === d)).toBe(true)
  })
  it('every stored line ends in checkmate', () => {
    for (const p of BANK) {
      const c = new Chess(p.fen)
      for (const m of p.line) c.move(m)
      expect(c.isCheckmate()).toBe(true)
    }
  })
  it('the first line move of a sample of puzzles validates at runtime', () => {
    // full-bank runtime validation is the generator's job; spot-check a sample
    const sample = [0, 1, 2, Math.floor(BANK.length / 2), BANK.length - 1].map(i => BANK[i])
    for (const p of sample) {
      expect(validPuzzleMoves(p.fen, p.depth)).toContain(p.line[0])
    }
  })
  it('bestDefense returns a legal reply', () => {
    const p = BANK.find(x => x.depth === 2)!
    const c = new Chess(p.fen)
    c.move(p.line[0])
    const d = bestDefense(c.fen())
    expect(d).toBeTruthy()
    expect(() => c.move(d!)).not.toThrow()
  })
})

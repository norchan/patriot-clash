import { Chess } from 'chess.js'

// ── Narrow forced-mate solver ────────────────────────────────────────────────
// Powers the Chess Puzzles game. For depth 1 any mating move counts; for
// depth > 1 only CHECKING moves are considered as attacking candidates, which
// keeps the search tree tiny (a king in check has few replies) and gives the
// puzzles the classic check-check-mate feel. The puzzle bank is GENERATED with
// this same solver (scripts/gen_chess_puzzles.mjs — keep the logic in sync),
// so runtime validation always agrees with generation.

export type Verbose = ReturnType<Chess['moves']> extends (infer M)[] ? M : never

/** SAN list of moves that deliver immediate checkmate. */
export function matingMoves(fen: string): string[] {
  const c = new Chess(fen)
  const out: string[] = []
  for (const m of c.moves()) {
    c.move(m)
    if (c.isCheckmate()) out.push(m)
    c.undo()
  }
  return out
}

/** Moves that give check (includes mates). */
export function checkingMoves(fen: string): string[] {
  const c = new Chess(fen)
  const out: string[] = []
  for (const m of c.moves()) {
    c.move(m)
    if (c.inCheck()) out.push(m)
    c.undo()
  }
  return out
}

/** Does the side to move force mate in <= n moves (checks-only lines)? */
export function forcesMateIn(fen: string, n: number): boolean {
  if (n <= 0) return false
  if (matingMoves(fen).length > 0) return true
  if (n === 1) return false
  for (const m of checkingMoves(fen)) {
    if (moveKeepsMate(fen, m, n)) return true
  }
  return false
}

/**
 * Is `san` a valid puzzle move with `n` moves left in the budget?
 * Valid = it mates now, or it checks and EVERY reply still allows mate in n-1.
 */
export function moveKeepsMate(fen: string, san: string, n: number): boolean {
  const c = new Chess(fen)
  try { c.move(san) } catch { return false }
  if (c.isCheckmate()) return true
  if (n <= 1) return false
  if (!c.inCheck()) return false // narrow solver: non-final puzzle moves must check
  for (const reply of c.moves()) {
    c.move(reply)
    const ok = forcesMateIn(c.fen(), n - 1)
    c.undo()
    if (!ok) return false
  }
  return true
}

/** All valid puzzle moves at this position with n moves left. */
export function validPuzzleMoves(fen: string, n: number): string[] {
  if (n === 1) return matingMoves(fen)
  const out = new Set(matingMoves(fen)) // early mate always allowed
  for (const m of checkingMoves(fen)) if (moveKeepsMate(fen, m, n)) out.add(m)
  return [...out]
}

/**
 * The defender's most resistant reply: the one that leaves the attacker the
 * fewest immediate mating moves (ties → fewest checking moves). All replies
 * lose by construction; this just avoids the opponent "helping".
 */
export function bestDefense(fen: string): string | null {
  const c = new Chess(fen)
  const replies = c.moves()
  if (replies.length === 0) return null
  let best: string = replies[0]
  let bestScore = Infinity
  for (const r of replies) {
    c.move(r)
    const f = c.fen()
    const score = matingMoves(f).length * 100 + checkingMoves(f).length
    c.undo()
    if (score < bestScore) { bestScore = score; best = r }
  }
  return best
}

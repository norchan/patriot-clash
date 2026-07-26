// Town Hall siege combat numbers — single source of truth for challenge
// damage rolls. Specials live in siege-attacks.ts; boosts in items.ts.
//
// Design (Michael 2026-07-26):
//  - Taking a hall should take MULTIPLE real assaults, not one dump.
//  - Damage can reduce defense to 0 → capture (no artificial "stuck at 1").
//  - 1 FP donated = 1 defense still holds.

/** FP cost of one challenge / assault */
export const CHALLENGE_FP_COST = 100

/**
 * Damage dealt by one successful challenge (server roll).
 * Old: 200–400 (often one-shot low/mid halls).
 * New: 45–90 — several marches needed on a healthy hall.
 */
export const CHALLENGE_DAMAGE_MIN = 45
export const CHALLENGE_DAMAGE_MAX = 90

/** Minimum defense after a capture when no ally cliques fund a garrison */
export const CAPTURE_BASE_DEFENSE = 500

/** Ally clique contribution to starting defense on capture */
export const CAPTURE_DEFENSE_PER_CLIQUE = 500

export function rollChallengeDamage(): number {
  const span = CHALLENGE_DAMAGE_MAX - CHALLENGE_DAMAGE_MIN
  return Math.floor(CHALLENGE_DAMAGE_MIN + Math.random() * (span + 1))
}

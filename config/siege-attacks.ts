// Party special attacks for Town Hall sieges. Shared by the siege battle UI
// (buttons + animations) and the server-side validator in
// /api/gyms/[id]/strike, which spends the FP and rolls the damage — one
// definition so the client can never invent cheaper or stronger strikes.

export type SiegeAttackId = 'tired' | 'poor' | 'free' | 'peace' | 'strength' | 'liberty'

export interface SiegeAttack {
  id: SiegeAttackId
  party: 'democrat' | 'republican'
  name: string
  emoji: string
  fp: number
  minDamage: number
  maxDamage: number
  desc: string
  /** Interceptable pieces in the volley — the hall's turrets roll against each
   *  one. Roughly matches what the siege screen actually draws. */
  salvo: number
}

// Three tiers per party — each button costs more and hits harder.
// Tuned DOWN (Michael 2026-07-26): halls should take real work, not one special.
// Strikes CAN finish a hall (DEF → 0 = capture); no floor-at-1.
export const SIEGE_ATTACKS: Record<SiegeAttackId, SiegeAttack> = {
  // ── Democrats: "Give me your tired, your poor, your huddled masses…" ────
  tired:    { id: 'tired',    party: 'democrat',   name: 'The Tired',           emoji: '🔱', fp: 50,  minDamage: 35,  maxDamage: 70,  salvo: 9, desc: 'A volley of pitchforks rains on the hall' },
  poor:     { id: 'poor',     party: 'democrat',   name: 'The Poor',            emoji: '✊', fp: 150, minDamage: 90,  maxDamage: 160, salvo: 7, desc: 'A furious mob storms the gates' },
  free:     { id: 'free',     party: 'democrat',   name: 'Yearning to Be Free', emoji: '💨', fp: 400, minDamage: 220, maxDamage: 320, salvo: 6, desc: 'The huddled masses charge in a cloud of smoke' },
  // ── Republicans ──────────────────────────────────────────────────────────
  peace:    { id: 'peace',    party: 'republican', name: 'Peace',    emoji: '🦅', fp: 50,  minDamage: 35,  maxDamage: 70,  salvo: 8, desc: 'Screaming eagles dive on the hall' },
  strength: { id: 'strength', party: 'republican', name: 'Strength', emoji: '🚀', fp: 150, minDamage: 90,  maxDamage: 160, salvo: 6, desc: 'A missile barrage levels the walls' },
  // id stays 'liberty' for wire compatibility (cached clients still send it) —
  // the CONTENT is the K-9 squad (Michael 2026-08-13: "I just don't like
  // [the statue]. Let's do a german sheperd attack with animations")
  liberty:  { id: 'liberty',  party: 'republican', name: 'K-9 Unit', emoji: '🐕‍🦺', fp: 400, minDamage: 220, maxDamage: 320, salvo: 4, desc: 'A squad of German Shepherds is unleashed on the hall' },
}

// ── HALL FLAK: the town hall shoots back ────────────────────────────────────
// Michael 2026-07-28: "the town hall should be knocking out every type of
// attack, or at least shooting at and damaging the incoming attacks."
//
// Turrets roll once per piece of the incoming volley. Two properties matter:
//
//  1. It scales with how well defended the hall IS, so a fortress is genuinely
//     hard to crack and a hall you've already beaten down stops shooting well.
//     That makes a siege accelerate as it goes instead of dragging — the last
//     hit is the easiest, not the hardest.
//  2. It can NEVER zero a strike. Specials cost up to 400 FP; spending that and
//     watching it evaporate would feel like being robbed, so even a fully
//     intercepted volley lands MIN_THROUGH of its damage.
//
// Tuned against live data (2,351 halls, median DEF 979, avg 1,433, max 5,866):
// a median hall shoots down ~1 piece in 5 and eats ~11% of a strike; a maxed
// fortress shoots down over half and eats ~28%.
export const FLAK = {
  DEF_FOR_FULL: 2500,    // defense at which turrets reach max accuracy
  MAX_HIT_CHANCE: 0.55,  // per-piece intercept chance at that defense
  MAX_BITE: 0.50,        // damage removed if the ENTIRE volley is intercepted
} as const

/** Per-piece intercept chance for a hall at this defense level. */
export function flakHitChance(defensePoints: number): number {
  const f = Math.max(0, Math.min(1, (defensePoints || 0) / FLAK.DEF_FOR_FULL))
  return f * FLAK.MAX_HIT_CHANCE
}

/** Roll the hall's return fire against one incoming strike. Pure so the
 *  economy tests can pin it with a seeded rand. */
export function rollFlak(
  attack: SiegeAttack,
  defensePoints: number,
  rand: () => number = Math.random,
): { salvo: number; intercepted: number; damageMult: number } {
  const p = flakHitChance(defensePoints)
  let intercepted = 0
  for (let i = 0; i < attack.salvo; i++) if (rand() < p) intercepted++
  const damageMult = 1 - (intercepted / attack.salvo) * FLAK.MAX_BITE
  return { salvo: attack.salvo, intercepted, damageMult }
}

export const ATTACKS_FOR_PARTY = (party: 'democrat' | 'republican'): SiegeAttack[] =>
  Object.values(SIEGE_ATTACKS).filter(a => a.party === party).sort((a, b) => a.fp - b.fp)

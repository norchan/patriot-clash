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
}

// Three tiers per party — each button costs more and hits harder
export const SIEGE_ATTACKS: Record<SiegeAttackId, SiegeAttack> = {
  // ── Democrats: "Give me your tired, your poor, your huddled masses…" ────
  tired:    { id: 'tired',    party: 'democrat',   name: 'The Tired',           emoji: '🔱', fp: 50,  minDamage: 250,  maxDamage: 450,  desc: 'A volley of pitchforks rains on the hall' },
  poor:     { id: 'poor',     party: 'democrat',   name: 'The Poor',            emoji: '✊', fp: 150, minDamage: 900,  maxDamage: 1500, desc: 'A furious mob storms the gates' },
  free:     { id: 'free',     party: 'democrat',   name: 'Yearning to Be Free', emoji: '💨', fp: 400, minDamage: 2800, maxDamage: 4200, desc: 'The huddled masses charge in a cloud of smoke' },
  // ── Republicans ──────────────────────────────────────────────────────────
  peace:    { id: 'peace',    party: 'republican', name: 'Peace',    emoji: '🦅', fp: 50,  minDamage: 250,  maxDamage: 450,  desc: 'Screaming eagles dive on the hall' },
  strength: { id: 'strength', party: 'republican', name: 'Strength', emoji: '🚀', fp: 150, minDamage: 900,  maxDamage: 1500, desc: 'A missile barrage levels the walls' },
  liberty:  { id: 'liberty',  party: 'republican', name: 'Liberty',  emoji: '🗽', fp: 400, minDamage: 2800, maxDamage: 4200, desc: 'Lady Liberty herself drops on the hall' },
}

export const ATTACKS_FOR_PARTY = (party: 'democrat' | 'republican'): SiegeAttack[] =>
  Object.values(SIEGE_ATTACKS).filter(a => a.party === party).sort((a, b) => a.fp - b.fp)

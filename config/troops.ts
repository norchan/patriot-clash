// TROOPS (Michael 2026-08-04): "five types of troops... different types of
// attacks... political themes. Each side gets their own."
//
// Five ROLES, mirrored across the parties so neither side out-guns the other —
// the same slot in each roster has identical cost/power/unlock, only the
// character and attack flavor differ. Barracks level N unlocks role N.
//
// How they fight (raids): army POWER raises raid damage (armyBonus below),
// defenses inflict CASUALTIES after the raid (casualtyPlan). The roles are
// mechanically real, not just flavor:
//   tank    — dies FIRST, soaking losses for the rest of the army
//   support — each one on the roster LOWERS the whole army's casualty rate
//   splash  — the biggest raw power per slot
// Costs are the FP sink that keeps raid loot honest: a big army hits harder
// but bleeds troops against fortified bases and must be retrained.

export type TroopRole = 'melee' | 'ranged' | 'tank' | 'splash' | 'support'
export type Party = 'republican' | 'democrat'

export interface TroopDef {
  id: string
  party: Party
  role: TroopRole
  name: string
  emoji: string
  attack: string   // their signature attack, shown in the training sheet
  desc: string
  cost: number     // FP per troop
  power: number    // army power each
  trainSecs: number    // build time per unit (Michael 2026-08-06: timer + queue)
  unlockLevel: number  // barracks level required
  img: string
}

// role order = unlock order = casualty order reference
export const ROLE_ORDER: readonly TroopRole[] = ['melee', 'ranged', 'tank', 'splash', 'support'] as const

// trainSecs scale with tier — a full army takes real time (or FP to rush),
// which is what makes casualties sting and the barracks worth upgrading
const ROLE_STATS: Record<TroopRole, { cost: number; power: number; unlockLevel: number; trainSecs: number }> = {
  melee:   { cost: 15,  power: 1, unlockLevel: 1, trainSecs: 45 },
  ranged:  { cost: 30,  power: 2, unlockLevel: 2, trainSecs: 90 },
  tank:    { cost: 60,  power: 3, unlockLevel: 3, trainSecs: 180 },
  splash:  { cost: 100, power: 4, unlockLevel: 4, trainSecs: 360 },
  support: { cost: 120, power: 3, unlockLevel: 5, trainSecs: 480 },
}

const t = (id: string, party: Party, role: TroopRole, name: string, emoji: string, attack: string, desc: string): TroopDef =>
  ({ id, party, role, name, emoji, attack, desc, ...ROLE_STATS[role], img: `/troops/${id}.png` })

export const TROOPS: readonly TroopDef[] = [
  // ── REPUBLICANS ──
  t('rep_minuteman', 'republican', 'melee', 'Minuteman', '🎩',
    'Bayonet Charge',
    'Reenactor with a real musket. First through the gate, every time.'),
  t('rep_buck_hunter', 'republican', 'ranged', 'Buck Hunter', '🏹',
    'Crossbow Volley',
    'Waits in total silence, then puts a bolt through a media tower at 200 yards.'),
  t('rep_big_rig', 'republican', 'tank', 'Big Rig Bubba', '🚛',
    'Chrome Door Wall',
    'Carries a semi-truck door as a shield. Soaks hits so the others keep swinging.'),
  t('rep_pyro_patriot', 'republican', 'splash', 'Pyro Patriot', '🎆',
    'Mortar Finale',
    'Shoulder-fired firework mortar. Hits everything in the yard at once.'),
  t('rep_revival_preacher', 'republican', 'support', 'Revival Preacher', '📣',
    'Altar Call',
    'Golden megaphone sermon keeps morale up — the whole army takes fewer losses.'),
  // ── DEMOCRATS ──
  t('dem_picket_captain', 'democrat', 'melee', 'Picket Captain', '🪧',
    'Sign Swing',
    'Union organizer swinging a picket sign off a 4x4 post. Negotiations have ended.'),
  t('dem_latte_slinger', 'democrat', 'ranged', 'Latte Slinger', '☕',
    'Scalding Pour-Over',
    'Dual portafilters, oat-milk bandolier. Third-degree burns, artisanal.'),
  t('dem_longshoreman', 'democrat', 'tank', 'Longshoreman', '⚓',
    'Dock Plate Wall',
    'Carries a riveted dock plate as a tower shield. The line does not move.'),
  t('dem_drum_circle', 'democrat', 'splash', 'Drum Circle Major', '🥁',
    'Sonic Downbeat',
    'One djembe slam rattles every window on the block. Area-of-effect vibes.'),
  t('dem_street_medic', 'democrat', 'support', 'Street Medic', '⛑️',
    'Patch-Up',
    'Milk jug and bandages at the ready — the whole army takes fewer losses.'),
] as const

export const troopsForParty = (party: string): TroopDef[] =>
  TROOPS.filter(tr => tr.party === party)
export const troopById = (id: string): TroopDef | undefined =>
  TROOPS.find(tr => tr.id === id)

// ── Raid math ───────────────────────────────────────────────────────────────

/** Total power of an army given {troop_type: count}. Unknown ids count 0. */
export function armyPower(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((s, [id, n]) => s + (troopById(id)?.power ?? 0) * Math.max(0, n), 0)
}

/** What the army adds to the attacker's level in raidDamagePct. Capped so a
 *  maxed army is a strong edge, not an auto-100. */
export function armyBonus(power: number): number {
  return Math.min(15, Math.floor(power / 4))
}

/** Casualties for one raid: rate rises with the defender's defense score,
 *  support troops pull it down, tanks die first (that's their job), support
 *  dies last. Returns losses per troop id. */
export function casualtyPlan(counts: Record<string, number>, defense: number): Record<string, number> {
  const entries = Object.entries(counts).filter(([id, n]) => n > 0 && troopById(id))
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total === 0) return {}
  const supportN = entries.reduce((s, [id, n]) => s + (troopById(id)!.role === 'support' ? n : 0), 0)
  const rate = Math.max(0.05, Math.min(0.32, 0.10 + defense * 0.008 - supportN * 0.01))
  let losses = Math.min(total, Math.ceil(total * rate))
  const deathOrder: TroopRole[] = ['tank', 'melee', 'ranged', 'splash', 'support']
  const plan: Record<string, number> = {}
  for (const role of deathOrder) {
    if (losses <= 0) break
    for (const [id, n] of entries) {
      if (troopById(id)!.role !== role || losses <= 0) continue
      const take = Math.min(n, losses)
      plan[id] = take
      losses -= take
    }
  }
  return plan
}

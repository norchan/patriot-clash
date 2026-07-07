// Player attack definitions shared by the battle UI and the server-side
// validator in /api/battles. Keeping one copy is what lets the server
// recompute FP costs and damage bounds instead of trusting the client.

export type GestureType = 'tap' | 'swipe-right' | 'swipe-up' | 'hold'

export interface PlayerAttack {
  name: string
  emoji: string
  damage: number
  fp: number
  color: string
  hint: string
  type: string
}

export const ATTACKS: Record<GestureType, PlayerAttack> = {
  tap:           { name: 'Quick Strike', emoji: '👊', damage: 20, fp: 8,  color: '#f59e0b', hint: 'TAP',     type: 'Normal'   },
  'swipe-right': { name: 'Power Slam',   emoji: '💥', damage: 38, fp: 15, color: '#ef4444', hint: '→ SWIPE', type: 'Fire'     },
  'swipe-up':    { name: 'Surge Strike', emoji: '⚡', damage: 60, fp: 25, color: '#8b5cf6', hint: '↑ SWIPE', type: 'Electric' },
  hold:          { name: 'Shield Block', emoji: '🛡️', damage:  0, fp: 5,  color: '#3b82f6', hint: 'HOLD',    type: 'Guard'    },
}

export const ATTACK_BY_NAME: Record<string, PlayerAttack> = Object.fromEntries(
  Object.values(ATTACKS).map(a => [a.name, a])
)

// Damage multiplier by enemy tier (tougher enemies take reduced damage).
// Client rolls damage as attack.damage * random(0.8–1.2) * TIER_DEFENSE[tier].
export const TIER_DEFENSE = { common: 1.0, rare: 0.82, legendary: 0.65 } as const

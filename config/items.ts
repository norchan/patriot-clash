// Battle boost items (Clash-of-Clans-style consumables for Siege Mode).
// Damage and prices are SERVER truth — the boost endpoint reads from here,
// the client only renders. Lethal hits (DEF → 0) CAN capture — no floor-at-1.

export type ItemType = 'firecracker' | 'dynamite' | 'rocket'

export interface BoostItem {
  id: ItemType
  name: string
  emoji: string
  damage: number
  price: number       // FP to buy one
  blurb: string
}

export const ITEMS: BoostItem[] = [
  { id: 'firecracker', name: 'Firecracker', emoji: '🧨', damage: 40,  price: 50,  blurb: 'Free one daily' },
  { id: 'dynamite',    name: 'Dynamite',    emoji: '💣', damage: 110, price: 150, blurb: 'Serious dent' },
  { id: 'rocket',      name: 'Rocket',      emoji: '🚀', damage: 250, price: 400, blurb: 'Wall breaker' },
]

export const ITEM_MAP = Object.fromEntries(ITEMS.map(i => [i.id, i])) as Record<ItemType, BoostItem>

// The daily freebie is always the weakest item
export const DAILY_FREE_ITEM: ItemType = 'firecracker'

import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultFighter, sanitizeFighter, fighterLevel, fighterStats } from '@/lib/fighter'
import type { FighterDesign } from '@/lib/fighter'

// Shared PvP battle resolution — used by /api/pvp/[id]/respond (human
// defenders accepting) and /api/pvp/challenge (bot defenders auto-accepting).
//
// Fights are 30-second single-round street fights: the server simulates a
// full timeline of punches, kicks and combos; the client replays it with the
// fighter rigs.

export type Move = 'jab' | 'cross' | 'hook' | 'kick' | 'jumpkick' | 'uppercut' | 'special'

export interface FightEvent {
  t: number                     // seconds into the round
  attacker: 'c' | 'd'
  move: Move
  result: 'hit' | 'blocked' | 'dodged'
  dmg: number
  chp: number
  dhp: number
  comboIndex: number            // position within a combo string (0-based)
  comboLen: number
}

export interface FightLog {
  version: 2
  duration: 30
  events: FightEvent[]
  winner: 'c' | 'd'
  endedBy: 'ko' | 'bell'
  endT: number
  cLevel: number
  dLevel: number
  cFighter: FighterDesign
  dFighter: FighterDesign
}

// Move ladder — every few levels unlocks a bigger move. `w` is the pick
// weight during normal exchanges (light moves are thrown far more often,
// exactly like a real fight).
export const MOVES: { move: Move; label: string; mult: number; minLevel: number; w: number }[] = [
  { move: 'jab',      label: 'Jab',          mult: 0.60, minLevel: 1,  w: 3.0 },
  { move: 'cross',    label: 'Cross',        mult: 0.85, minLevel: 1,  w: 2.6 },
  { move: 'hook',     label: 'Hook',         mult: 1.05, minLevel: 2,  w: 2.0 },
  { move: 'kick',     label: 'Kick',         mult: 1.25, minLevel: 4,  w: 1.8 },
  { move: 'jumpkick', label: 'Jump Kick',    mult: 1.50, minLevel: 7,  w: 1.1 },
  { move: 'uppercut', label: 'Uppercut',     mult: 1.65, minLevel: 9,  w: 0.9 },
  { move: 'special',  label: 'SPECIAL',      mult: 2.10, minLevel: 12, w: 0.5 },
]

export function movesForLevel(level: number) {
  return MOVES.filter(m => m.minLevel <= level)
}

function weightedPick<T extends { w: number }>(pool: T[]): T {
  const total = pool.reduce((s, m) => s + m.w, 0)
  let r = Math.random() * total
  for (const m of pool) { r -= m.w; if (r <= 0) return m }
  return pool[pool.length - 1]
}

export function simulateStreetFight(
  cLevel: number, dLevel: number,
  cFighter: FighterDesign, dFighter: FighterDesign
): FightLog {
  const cs = fighterStats(cLevel)
  const ds = fighterStats(dLevel)
  let chp = 100, dhp = 100
  const events: FightEvent[] = []

  let t = 1.6
  let endedBy: 'ko' | 'bell' = 'bell'
  let endT = 30

  while (t < 28 && chp > 0 && dhp > 0) {
    // Who attacks: weighted by stamina (higher level presses more often,
    // but the underdog still gets real turns)
    const cTurn = Math.random() < cs.stamina / (cs.stamina + ds.stamina)
    const atk = cTurn ? cs : ds
    const def = cTurn ? ds : cs

    // Most exchanges are single strikes; combos are the exception that
    // makes the crowd pop, capped by the attacker's combo unlock
    const comboLen = Math.random() < 0.4
      ? 1 + Math.floor(Math.random() * atk.comboMax)
      : 1
    const pool = movesForLevel(atk.level)

    for (let i = 0; i < comboLen; i++) {
      // Combo finishers favor the two heaviest unlocked moves
      const m = i === comboLen - 1 && comboLen > 1
        ? pool[pool.length - 1 - Math.floor(Math.random() * Math.min(2, pool.length))]
        : weightedPick(pool)

      const roll = Math.random()
      // Mid-combo hits are harder to defend
      const defendScale = i === 0 ? 1 : 0.45
      let result: FightEvent['result'] = 'hit'
      if (roll < def.dodgeChance * defendScale) result = 'dodged'
      else if (roll < (def.dodgeChance + def.blockChance) * defendScale) result = 'blocked'

      let dmg = 0
      if (result !== 'dodged') {
        // Damage is tuned so a KO takes ~8-14 clean hits: fights fill most
        // of the 30-second round instead of ending on one combo
        const base = 3.5 + atk.strength * 0.33
        const falloff = Math.pow(0.8, i) // later combo hits land softer
        dmg = Math.max(1, Math.round(base * m.mult * falloff * (0.85 + Math.random() * 0.3)))
        if (result === 'blocked') dmg = Math.max(1, Math.floor(dmg * 0.25))
      }

      if (cTurn) dhp = Math.max(0, dhp - dmg)
      else chp = Math.max(0, chp - dmg)

      events.push({
        t: Number(t.toFixed(2)),
        attacker: cTurn ? 'c' : 'd',
        move: m.move,
        result,
        dmg,
        chp, dhp,
        comboIndex: i,
        comboLen,
      })

      t += 0.45
      if (chp === 0 || dhp === 0) break
    }

    if (chp === 0 || dhp === 0) {
      endedBy = 'ko'
      endT = Math.min(29, Number((t + 0.4).toFixed(2)))
      break
    }

    // Breather between exchanges — fitter fighters press faster
    t += 1.0 + Math.random() * 1.0
  }

  const winner: 'c' | 'd' = chp === dhp ? 'c' : chp > dhp ? 'c' : 'd'

  return {
    version: 2,
    duration: 30,
    events,
    winner: dhp === 0 ? 'c' : chp === 0 ? 'd' : winner,
    endedBy,
    endT,
    cLevel, dLevel,
    cFighter, dFighter,
  }
}

function seededRand(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return Math.abs(h) / 2147483647
}

export type ResolveResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; error: string }

// Runs the battle for a challenge that has already been claimed (status
// 'resolving'): checks balances, simulates, transfers FP with rollback on
// partial failure, and writes the completed row. Bots with a drained
// treasury are refilled so they always have a stake to lose.
export async function resolvePvpChallenge(
  admin: SupabaseClient,
  challenge: { id: string; challenger_id: string; defender_id: string; fp_stake: number }
): Promise<ResolveResult> {
  const cancel = async () => {
    await admin.from('pvp_challenges').update({ status: 'cancelled' }).eq('id', challenge.id)
  }

  const [{ data: challenger }, { data: defender }] = await Promise.all([
    admin.from('profiles').select('id, fp_balance, username, party, clerk_user_id, fighter, total_battles_won, total_battles_lost').eq('id', challenge.challenger_id).single(),
    admin.from('profiles').select('id, fp_balance, username, party, clerk_user_id, fighter, total_battles_won, total_battles_lost').eq('id', challenge.defender_id).single(),
  ])

  if (!challenger || !defender) {
    await cancel()
    return { ok: false, status: 404, error: 'Player profile not found' }
  }

  // Bot treasury refill: bots must always be able to pay out a win
  if (defender.clerk_user_id?.startsWith('bot_') && defender.fp_balance < challenge.fp_stake) {
    await admin.rpc('grant_fp', {
      p_profile_id: defender.id, p_amount: 5000,
      p_type: 'battle_reward', p_reference_type: 'pvp_battle',
      p_description: 'Bot treasury refill',
    })
    defender.fp_balance += 5000
  }

  if (challenger.fp_balance < challenge.fp_stake || defender.fp_balance < challenge.fp_stake) {
    await cancel()
    return { ok: false, status: 400, error: 'Insufficient FP — challenge cancelled' }
  }

  // Levels come from battles won for EVERYONE — bots included. Bots start
  // near level 1 (small seeded win counts) and climb only by actually
  // winning fights, so the world levels up alongside the players.
  const cLevel = fighterLevel(challenger.total_battles_won ?? 0)
  const dLevel = fighterLevel(defender.total_battles_won ?? 0)

  const result = simulateStreetFight(
    cLevel, dLevel,
    sanitizeFighter(challenger.fighter, challenger.id),
    sanitizeFighter(defender.fighter, defender.id),
  )

  const finalEvent = result.events[result.events.length - 1]
  const challengerHp = finalEvent?.chp ?? 100
  const defenderHp = finalEvent?.dhp ?? 100

  const winnerId  = result.winner === 'c' ? challenger.id : defender.id
  const loserId   = result.winner === 'c' ? defender.id  : challenger.id
  const winnerName = result.winner === 'c' ? challenger.username : defender.username
  const loserName  = result.winner === 'c' ? defender.username  : challenger.username

  // Debit the loser first and check — supabase rpc() returns errors rather
  // than throwing, and an unchecked failure here would mint FP
  const { error: spendErr } = await admin.rpc('spend_fp', {
    p_profile_id: loserId, p_amount: challenge.fp_stake,
    p_type: 'gym_attack', p_reference_type: 'pvp_battle',
    p_description: `Lost PvP vs ${winnerName}`,
  })
  if (spendErr) {
    console.error('pvp spend_fp failed:', spendErr)
    await cancel()
    return { ok: false, status: 500, error: 'FP transfer failed — challenge cancelled' }
  }

  const { error: grantErr } = await admin.rpc('grant_fp', {
    p_profile_id: winnerId, p_amount: challenge.fp_stake,
    p_type: 'battle_reward', p_reference_type: 'pvp_battle',
    p_description: `Won PvP vs ${loserName}`,
  })
  if (grantErr) {
    // Loser was already debited — refund them before cancelling
    console.error('pvp grant_fp failed, refunding loser:', grantErr)
    await admin.rpc('grant_fp', {
      p_profile_id: loserId, p_amount: challenge.fp_stake,
      p_type: 'battle_reward', p_reference_type: 'pvp_battle',
      p_description: 'PvP stake refund (transfer failed)',
    })
    await cancel()
    return { ok: false, status: 500, error: 'FP transfer failed — challenge cancelled' }
  }

  const { error: saveErr } = await admin.from('pvp_challenges').update({
    status: 'completed',
    winner_id: winnerId,
    challenger_hp_remaining: challengerHp,
    defender_hp_remaining:   defenderHp,
    turns_played: result.events.length,
    battle_log:   result,
  }).eq('id', challenge.id)

  if (saveErr) {
    // Couldn't record the result (e.g. schema drift) — unwind the stake so no
    // FP is lost, then surface the real error instead of a stuck challenge
    console.error('pvp result save failed, rolling back stake:', saveErr)
    await admin.rpc('grant_fp', {
      p_profile_id: loserId, p_amount: challenge.fp_stake,
      p_type: 'battle_reward', p_reference_type: 'pvp_battle',
      p_description: 'PvP stake refund (result save failed)',
    })
    await admin.rpc('spend_fp', {
      p_profile_id: winnerId, p_amount: challenge.fp_stake,
      p_type: 'gym_attack', p_reference_type: 'pvp_battle',
      p_description: 'PvP stake clawback (result save failed)',
    })
    await cancel()
    return { ok: false, status: 500, error: `Could not save fight result: ${saveErr.message}` }
  }

  // Fight record feeds fighter levels — this is how both humans AND bots
  // level up (or don't) over time
  const winner = result.winner === 'c' ? challenger : defender
  const loser  = result.winner === 'c' ? defender : challenger
  await Promise.all([
    admin.from('profiles').update({ total_battles_won: (winner.total_battles_won ?? 0) + 1 }).eq('id', winner.id),
    admin.from('profiles').update({ total_battles_lost: (loser.total_battles_lost ?? 0) + 1 }).eq('id', loser.id),
  ])

  return {
    ok: true,
    payload: {
      status: 'completed',
      winner_id:    winnerId,
      challenger_id: challenge.challenger_id,
      defender_id:   challenge.defender_id,
      challenger_hp_remaining: challengerHp,
      defender_hp_remaining:   defenderHp,
      turns_played: result.events.length,
      fp_stake: challenge.fp_stake,
      battle_log: result,
      challenger_username: challenger.username,
      defender_username:   defender.username,
      challenger_party:    challenger.party,
      defender_party:      defender.party,
    },
  }
}

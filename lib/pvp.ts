import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultFighter, sanitizeFighter, fighterLevel, fighterStats } from '@/lib/fighter'
import type { FighterDesign } from '@/lib/fighter'

// Shared PvP battle resolution — used by /api/pvp/[id]/respond (human
// defenders accepting) and /api/pvp/challenge (bot defenders auto-accepting).
//
// Fights are 30-second single-round street fights: the server simulates a
// full timeline of punches, kicks and combos; the client replays it with the
// fighter rigs.

export type Move = 'jab' | 'cross' | 'hook' | 'uppercut' | 'kick'

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

const MOVES: { move: Move; mult: number; minLevel: number }[] = [
  { move: 'jab',      mult: 0.7,  minLevel: 1 },
  { move: 'cross',    mult: 1.0,  minLevel: 1 },
  { move: 'hook',     mult: 1.25, minLevel: 1 },
  { move: 'kick',     mult: 1.5,  minLevel: 2 },
  { move: 'uppercut', mult: 1.8,  minLevel: 10 },
]

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
    // Who attacks: weighted by stamina
    const cTurn = Math.random() < cs.stamina / (cs.stamina + ds.stamina)
    const atk = cTurn ? cs : ds
    const def = cTurn ? ds : cs

    // Combo length: mostly short, capped by level unlocks
    const comboLen = 1 + Math.floor(Math.random() * atk.comboMax)
    const pool = MOVES.filter(m => m.minLevel <= atk.level)

    for (let i = 0; i < comboLen; i++) {
      // Later combo hits favor bigger moves — finish with the heavy stuff
      const m = i === comboLen - 1 && comboLen > 1
        ? pool[pool.length - 1 - Math.floor(Math.random() * Math.min(2, pool.length))]
        : pool[Math.floor(Math.random() * pool.length)]

      const roll = Math.random()
      // Mid-combo hits are harder to defend
      const defendScale = i === 0 ? 1 : 0.45
      let result: FightEvent['result'] = 'hit'
      if (roll < def.dodgeChance * defendScale) result = 'dodged'
      else if (roll < (def.dodgeChance + def.blockChance) * defendScale) result = 'blocked'

      let dmg = 0
      if (result !== 'dodged') {
        dmg = Math.max(1, Math.floor(atk.strength * m.mult * (0.8 + Math.random() * 0.4)))
        if (result === 'blocked') dmg = Math.floor(dmg * 0.25)
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

      t += 0.32
      if (chp === 0 || dhp === 0) break
    }

    if (chp === 0 || dhp === 0) {
      endedBy = 'ko'
      endT = Math.min(29, Number((t + 0.4).toFixed(2)))
      break
    }

    // Breather between exchanges — fitter fighters press faster
    const tempo = 2.6 - Math.min(1.4, (atk.stamina + def.stamina) / 30)
    t += tempo * (0.7 + Math.random() * 0.6)
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
    admin.from('profiles').select('id, fp_balance, username, party, clerk_user_id, fighter, total_battles_won').eq('id', challenge.challenger_id).single(),
    admin.from('profiles').select('id, fp_balance, username, party, clerk_user_id, fighter, total_battles_won').eq('id', challenge.defender_id).single(),
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

  // Levels: humans earn theirs from battles won; bots get a stable seeded
  // level (3-15) so the world has a spread of opponents
  const cLevel = challenger.clerk_user_id?.startsWith('bot_')
    ? 3 + Math.floor(seededRand(challenger.id) * 13)
    : fighterLevel(challenger.total_battles_won ?? 0)
  const dLevel = defender.clerk_user_id?.startsWith('bot_')
    ? 3 + Math.floor(seededRand(defender.id) * 13)
    : fighterLevel(defender.total_battles_won ?? 0)

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

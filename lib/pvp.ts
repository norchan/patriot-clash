import type { SupabaseClient } from '@supabase/supabase-js'
import { fighterLevel, sanitizeFighter } from '@/lib/fighter'
import type { FighterDesign } from '@/lib/fighter'

// PvP street fights are INTERACTIVE: the challenger actually fights on the
// battle screen (taps punch, swipes kick, hold blocks) against the
// defender's fighter, which is driven at the defender's level. The client
// submits the outcome; this module validates it hard and settles the stakes.
//
// FightLog v2 (server-simulated replays) is kept only so old completed
// fights still render.

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

// Move ladder — every few levels unlocks a bigger move
export const MOVES: { move: Move; label: string; mult: number; minLevel: number; w: number }[] = [
  { move: 'jab',      label: 'Jab',          mult: 0.60, minLevel: 1,  w: 3.0 },
  { move: 'cross',    label: 'Cross',        mult: 0.85, minLevel: 1,  w: 2.6 },
  { move: 'hook',     label: 'Hook (3-tap combo)', mult: 1.05, minLevel: 2,  w: 2.0 },
  { move: 'kick',     label: 'Kick (swipe ➡)', mult: 1.25, minLevel: 4,  w: 1.8 },
  { move: 'jumpkick', label: 'Jump Kick (swipe ⬆)', mult: 1.50, minLevel: 7,  w: 1.1 },
  { move: 'uppercut', label: 'Uppercut (combo finisher)', mult: 1.65, minLevel: 9,  w: 0.9 },
  { move: 'special',  label: 'SPECIAL (full meter)', mult: 2.10, minLevel: 12, w: 0.5 },
]

export function movesForLevel(level: number) {
  return MOVES.filter(m => m.minLevel <= level)
}

// ── Interactive fight settlement ─────────────────────────────────────────────

export interface FightSubmission {
  won: boolean
  myHp: number       // challenger HP at the end
  foeHp: number      // defender HP at the end
  duration: number   // seconds
  counts: { taps: number; kicks: number; jumpkicks: number; blocks: number; combos: number; specials: number }
}

export type ResolveResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; error: string }

const int = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN

// Validates a submitted fight outcome, transfers the stakes with rollback on
// partial failure, and records the completed fight. The challenge row must
// currently be 'accepted' (armed); claiming it to 'resolving' is atomic, so
// a fight can only ever be settled once.
export async function settleInteractiveFight(
  admin: SupabaseClient,
  challenge: {
    id: string; challenger_id: string; defender_id: string
    fp_stake: number; accepted_at: string | null
  },
  raw: any
): Promise<ResolveResult> {
  const cancel = async () => {
    await admin.from('pvp_challenges').update({ status: 'cancelled' }).eq('id', challenge.id)
  }

  // --- Sanity-check the submission (server is the authority on money) ---
  const sub: FightSubmission = {
    won: !!raw?.won,
    myHp: int(raw?.myHp),
    foeHp: int(raw?.foeHp),
    duration: int(raw?.duration),
    counts: {
      taps: int(raw?.counts?.taps) || 0,
      kicks: int(raw?.counts?.kicks) || 0,
      jumpkicks: int(raw?.counts?.jumpkicks) || 0,
      blocks: int(raw?.counts?.blocks) || 0,
      combos: int(raw?.counts?.combos) || 0,
      specials: int(raw?.counts?.specials) || 0,
    },
  }

  const bad = (reason: string): ResolveResult => ({ ok: false, status: 400, error: `Invalid fight result: ${reason}` })

  if (![sub.myHp, sub.foeHp, sub.duration].every(Number.isFinite)) return bad('malformed')
  if (sub.myHp < 0 || sub.myHp > 100 || sub.foeHp < 0 || sub.foeHp > 100) return bad('hp out of range')
  if (sub.duration < 14 || sub.duration > 35) return bad('impossible duration')
  // Winner must be consistent with the HP story
  if (sub.won && !(sub.foeHp === 0 || sub.myHp > sub.foeHp)) return bad('inconsistent outcome')
  if (!sub.won && !(sub.myHp === 0 || sub.foeHp >= sub.myHp)) return bad('inconsistent outcome')
  // Damage-rate ceiling: even perfect play can't exceed ~9 dmg/sec
  if (100 - sub.foeHp > sub.duration * 9 + 15) return bad('impossible damage output')
  if (sub.counts.taps > sub.duration * 6) return bad('impossible input rate')

  // Wall-clock check: the fight must have actually taken the time it claims
  if (challenge.accepted_at) {
    const elapsed = Date.now() - new Date(challenge.accepted_at).getTime()
    if (elapsed < 12_000) return bad('finished faster than physically possible')
    if (elapsed > 10 * 60_000) {
      await cancel()
      return { ok: false, status: 400, error: 'Fight expired — challenge cancelled, no FP moved' }
    }
  }

  // --- Claim: accepted → resolving, exactly once ---
  const { data: claimed } = await admin
    .from('pvp_challenges')
    .update({ status: 'resolving' })
    .eq('id', challenge.id)
    .eq('status', 'accepted')
    .select('id')
    .maybeSingle()
  if (!claimed) return { ok: false, status: 409, error: 'Fight already settled' }

  const [{ data: challenger }, { data: defender }] = await Promise.all([
    admin.from('profiles').select('id, fp_balance, username, party, clerk_user_id, fighter, total_battles_won, total_battles_lost').eq('id', challenge.challenger_id).single(),
    admin.from('profiles').select('id, fp_balance, username, party, clerk_user_id, fighter, total_battles_won, total_battles_lost').eq('id', challenge.defender_id).single(),
  ])

  if (!challenger || !defender) {
    await cancel()
    return { ok: false, status: 404, error: 'Player profile not found' }
  }

  const winner = sub.won ? challenger : defender
  const loser  = sub.won ? defender : challenger

  // Challenging is free: the loser forfeits up to the stake, or everything
  // they have if that's less (balance floors at zero — never negative).
  const potAmount = Math.max(0, Math.min(challenge.fp_stake, loser.fp_balance))

  let paid = 0
  if (potAmount > 0) {
    // Debit the loser first and check — supabase rpc() returns errors rather
    // than throwing, and an unchecked failure here would mint FP
    const { error: spendErr } = await admin.rpc('spend_fp', {
      p_profile_id: loser.id, p_amount: potAmount,
      p_type: 'gym_attack', p_reference_type: 'pvp_battle',
      p_description: `Lost PvP vs ${winner.username}`,
    })
    if (spendErr) {
      console.error('pvp spend_fp failed:', spendErr)
      await cancel()
      return { ok: false, status: 500, error: 'FP transfer failed — challenge cancelled' }
    }
    paid = potAmount

    const { error: grantErr } = await admin.rpc('grant_fp', {
      p_profile_id: winner.id, p_amount: potAmount,
      p_type: 'battle_reward', p_reference_type: 'pvp_battle',
      p_description: `Won PvP vs ${loser.username}`,
    })
    if (grantErr) {
      console.error('pvp grant_fp failed, refunding loser:', grantErr)
      await admin.rpc('grant_fp', {
        p_profile_id: loser.id, p_amount: potAmount,
        p_type: 'battle_reward', p_reference_type: 'pvp_battle',
        p_description: 'PvP stake refund (transfer failed)',
      })
      await cancel()
      return { ok: false, status: 500, error: 'FP transfer failed — challenge cancelled' }
    }
  }

  const battleLog = {
    version: 3 as const,
    mode: 'interactive' as const,
    duration: sub.duration,
    winner: sub.won ? 'c' : 'd',
    endedBy: sub.myHp === 0 || sub.foeHp === 0 ? 'ko' : 'bell',
    chp: sub.myHp,
    dhp: sub.foeHp,
    counts: sub.counts,
    cLevel: fighterLevel(challenger.total_battles_won ?? 0),
    dLevel: fighterLevel(defender.total_battles_won ?? 0),
    cFighter: sanitizeFighter(challenger.fighter, challenger.id),
    dFighter: sanitizeFighter(defender.fighter, defender.id),
  }

  const { error: saveErr } = await admin.from('pvp_challenges').update({
    status: 'completed',
    winner_id: winner.id,
    challenger_hp_remaining: sub.myHp,
    defender_hp_remaining:   sub.foeHp,
    turns_played: sub.counts.taps + sub.counts.kicks + sub.counts.jumpkicks + sub.counts.specials,
    battle_log: battleLog,
  }).eq('id', challenge.id)

  if (saveErr) {
    console.error('pvp result save failed, rolling back stake:', saveErr)
    if (paid > 0) {
      await admin.rpc('grant_fp', {
        p_profile_id: loser.id, p_amount: paid,
        p_type: 'battle_reward', p_reference_type: 'pvp_battle',
        p_description: 'PvP stake refund (result save failed)',
      })
      await admin.rpc('spend_fp', {
        p_profile_id: winner.id, p_amount: paid,
        p_type: 'gym_attack', p_reference_type: 'pvp_battle',
        p_description: 'PvP stake clawback (result save failed)',
      })
    }
    await cancel()
    return { ok: false, status: 500, error: `Could not save fight result: ${saveErr.message}` }
  }

  // Fight record feeds fighter levels — this is how both humans AND bots
  // level up (or don't) over time
  await Promise.all([
    admin.from('profiles').update({ total_battles_won: (winner.total_battles_won ?? 0) + 1 }).eq('id', winner.id),
    admin.from('profiles').update({ total_battles_lost: (loser.total_battles_lost ?? 0) + 1 }).eq('id', loser.id),
  ])

  return {
    ok: true,
    payload: {
      status: 'completed',
      winner_id: winner.id,
      challenger_id: challenge.challenger_id,
      defender_id: challenge.defender_id,
      challenger_hp_remaining: sub.myHp,
      defender_hp_remaining: sub.foeHp,
      fp_stake: paid,
      battle_log: battleLog,
    },
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const PVP_MOVES = [
  { name: 'Quick Strike',  emoji: '👊', mult: 0.85 },
  { name: 'Power Slam',    emoji: '💥', mult: 1.30 },
  { name: 'Surge Strike',  emoji: '⚡', mult: 1.75 },
  { name: 'Shield Block',  emoji: '🛡️', mult: 0.25 },
]

interface TurnLog {
  turn: number
  challengerMove: string
  defenderMove: string
  challengerDmg: number
  defenderDmg: number
  challengerHpAfter: number
  defenderHpAfter: number
}

function simulateBattle(challengerFp: number, defenderFp: number) {
  let challengerHp = 100
  let defenderHp = 100
  const log: TurnLog[] = []

  const cPow = 10 + Math.min(challengerFp * 0.02, 15)
  const dPow = 10 + Math.min(defenderFp * 0.02, 15)

  for (let turn = 1; turn <= 15 && challengerHp > 0 && defenderHp > 0; turn++) {
    const cMove = PVP_MOVES[Math.floor(Math.random() * PVP_MOVES.length)]
    const dMove = PVP_MOVES[Math.floor(Math.random() * PVP_MOVES.length)]
    const cDmg = Math.max(0, Math.floor(cPow * cMove.mult * (0.8 + Math.random() * 0.4)))
    const dDmg = Math.max(0, Math.floor(dPow * dMove.mult * (0.8 + Math.random() * 0.4)))

    defenderHp   = Math.max(0, defenderHp   - cDmg)
    challengerHp = Math.max(0, challengerHp - dDmg)

    log.push({
      turn,
      challengerMove: `${cMove.emoji} ${cMove.name}`,
      defenderMove:   `${dMove.emoji} ${dMove.name}`,
      challengerDmg: cDmg,
      defenderDmg:   dDmg,
      challengerHpAfter: challengerHp,
      defenderHpAfter:   defenderHp,
    })

    if (challengerHp === 0 || defenderHp === 0) break
  }

  return {
    winner: challengerHp >= defenderHp ? 'challenger' as const : 'defender' as const,
    challengerHp,
    defenderHp,
    turns: log.length,
    log,
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params
    const { accept } = await req.json()

    const { data: challenge } = await admin
      .from('pvp_challenges')
      .select('*')
      .eq('id', id)
      .eq('defender_id', profile.id)
      .eq('status', 'pending')
      .single()

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found or already resolved' }, { status: 404 })
    }

    if (new Date(challenge.expires_at) < new Date()) {
      await admin.from('pvp_challenges').update({ status: 'expired' }).eq('id', id)
      return NextResponse.json({ error: 'Challenge has expired' }, { status: 400 })
    }

    if (!accept) {
      await admin.from('pvp_challenges').update({ status: 'declined' }).eq('id', id)
      return NextResponse.json({ status: 'declined' })
    }

    const [{ data: challenger }, { data: defender }] = await Promise.all([
      admin.from('profiles').select('id, fp_balance, username, party').eq('id', challenge.challenger_id).single(),
      admin.from('profiles').select('id, fp_balance, username, party').eq('id', challenge.defender_id).single(),
    ])

    if (!challenger || !defender) {
      return NextResponse.json({ error: 'Player profile not found' }, { status: 404 })
    }

    if (challenger.fp_balance < challenge.fp_stake || defender.fp_balance < challenge.fp_stake) {
      await admin.from('pvp_challenges').update({ status: 'cancelled' }).eq('id', id)
      return NextResponse.json({ error: 'Insufficient FP — challenge cancelled' }, { status: 400 })
    }

    const result = simulateBattle(challenger.fp_balance, defender.fp_balance)

    const winnerId  = result.winner === 'challenger' ? challenger.id : defender.id
    const loserId   = result.winner === 'challenger' ? defender.id  : challenger.id
    const winnerName = result.winner === 'challenger' ? challenger.username : defender.username
    const loserName  = result.winner === 'challenger' ? defender.username  : challenger.username

    await Promise.all([
      admin.rpc('spend_fp', {
        p_profile_id: loserId, p_amount: challenge.fp_stake,
        p_type: 'pvp_loss', p_reference_type: 'pvp_battle',
        p_description: `Lost PvP vs ${winnerName}`,
      }),
      admin.rpc('grant_fp', {
        p_profile_id: winnerId, p_amount: challenge.fp_stake,
        p_type: 'pvp_win', p_reference_type: 'pvp_battle',
        p_description: `Won PvP vs ${loserName}`,
      }),
    ])

    await admin.from('pvp_challenges').update({
      status: 'completed',
      winner_id: winnerId,
      challenger_hp_remaining: result.challengerHp,
      defender_hp_remaining:   result.defenderHp,
      turns_played: result.turns,
      battle_log:   result.log,
    }).eq('id', id)

    return NextResponse.json({
      status: 'completed',
      winner_id:    winnerId,
      challenger_id: challenge.challenger_id,
      defender_id:   challenge.defender_id,
      challenger_hp_remaining: result.challengerHp,
      defender_hp_remaining:   result.defenderHp,
      turns_played: result.turns,
      fp_stake: challenge.fp_stake,
      battle_log: result.log,
      challenger_username: challenger.username,
      defender_username:   defender.username,
      challenger_party:    challenger.party,
      defender_party:      defender.party,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/pvp/[id]/respond error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

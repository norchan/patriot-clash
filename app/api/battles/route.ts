import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { getEnemyById } from '@/config/enemies'
import { ATTACK_BY_NAME, TIER_DEFENSE } from '@/config/attacks'

// =============================================================================
// POST /api/battles
// Records a completed battle against a field enemy.
// Handles FP spending, rewards, and profile stat updates.
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const body = await req.json()
    const {
      enemy_id,
      result,         // 'victory' | 'defeat' | 'fled'
      moves_used,     // [{name, power, damage}] — fp cost is recomputed from this
      latitude,
      longitude,
      duration_secs,
    } = body

    // Validate enemy exists
    const enemy = getEnemyById(enemy_id)
    if (!enemy) {
      return NextResponse.json({ error: 'Invalid enemy' }, { status: 400 })
    }

    // Validate result
    if (!['victory', 'defeat', 'fled'].includes(result)) {
      return NextResponse.json({ error: 'Invalid result' }, { status: 400 })
    }

    // ── Server-side battle validation ─────────────────────────────────────
    // The client's fp_spent and result are not trusted. FP cost is recomputed
    // from the submitted moves, each move must be a real attack with damage
    // inside its possible roll range, and a victory claim must be backed by
    // enough total damage to actually defeat the enemy.
    const moves: { name?: string; damage?: number }[] = Array.isArray(moves_used) ? moves_used : []
    if (moves.length > 100) {
      return NextResponse.json({ error: 'Too many moves' }, { status: 400 })
    }

    const tierMult = TIER_DEFENSE[enemy.tier as keyof typeof TIER_DEFENSE] ?? 1.0
    let fpCost = 0
    let totalDamage = 0
    for (const m of moves) {
      const atk = ATTACK_BY_NAME[m?.name ?? '']
      if (!atk) {
        return NextResponse.json({ error: 'Invalid move in battle log' }, { status: 400 })
      }
      const dmg = Number(m?.damage) || 0
      const maxRoll = Math.ceil(atk.damage * 1.2 * tierMult)
      if (dmg < 0 || dmg > maxRoll) {
        return NextResponse.json({ error: 'Impossible damage value' }, { status: 400 })
      }
      fpCost += atk.fp
      totalDamage += dmg
    }

    if (result === 'victory' && totalDamage < enemy.hp) {
      return NextResponse.json({ error: 'Claimed victory without dealing enough damage' }, { status: 400 })
    }

    if (fpCost > 0 && profile.fp_balance < fpCost) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP' }, { status: 400 })
    }

    // Calculate FP reward based on result and enemy tier
    let fpReward = 0
    if (result === 'victory') {
      fpReward = enemy.fpReward
      // Bonus for legendary enemies
      if (enemy.tier === 'legendary') fpReward = Math.floor(fpReward * 1.5)
    } else if (result === 'defeat') {
      fpReward = Math.floor(enemy.fpReward * 0.1) // Small consolation
    }

    // Spend FP if any was used
    if (fpCost > 0) {
      await admin.rpc('spend_fp', {
        p_profile_id: profile.id,
        p_amount: fpCost,
        p_type: 'gym_attack',
        p_reference_type: 'battle',
        p_description: `Battle vs ${enemy.name}: ${result}`
      })
    }

    // Award FP for result
    if (fpReward > 0) {
      await admin.rpc('grant_fp', {
        p_profile_id: profile.id,
        p_amount: fpReward,
        p_type: 'battle_reward',
        p_reference_type: 'battle',
        p_description: `${result === 'victory' ? 'Defeated' : 'Battled'} ${enemy.name}`
      })
    }

    // Record the battle
    const { data: battle, error: battleError } = await admin
      .from('battles')
      .insert({
        profile_id: profile.id,
        enemy_type: enemy.id,
        enemy_name: enemy.name,
        enemy_tier: enemy.tier,
        fp_spent: fpCost,
        fp_earned: fpReward,
        result,
        moves_used: moves_used || [],
        latitude,
        longitude,
        duration_secs,
      })
      .select()
      .single()

    if (battleError) throw battleError

    // Update profile stats for victories — and CAPTURE the beaten sprite.
    // Winning a sprite battle catches the character automatically (duplicates
    // welcome; extras sell back for FP from the Collection).
    let captured = false
    if (result === 'victory') {
      await admin
        .from('profiles')
        .update({
          total_battles_won: profile.total_battles_won + 1,
          total_captures: (profile.total_captures ?? 0) + 1,
        })
        .eq('id', profile.id)
      const { error: capErr } = await admin.from('captured_characters').insert({
        profile_id: profile.id,
        enemy_id: enemy.id,
        enemy_name: enemy.name,
        enemy_tier: enemy.tier,
        enemy_image: enemy.image,
        enemy_party: enemy.party,
        battle_id: battle?.id ?? null,
      })
      captured = !capErr
    } else if (result === 'defeat') {
      await admin
        .from('profiles')
        .update({
          total_battles_lost: profile.total_battles_lost + 1,
        })
        .eq('id', profile.id)
    }

    // Get updated balance
    const { data: updated } = await admin
      .from('profiles')
      .select('fp_balance, total_battles_won')
      .eq('id', profile.id)
      .single()

    return NextResponse.json({
      success: true,
      battle_id: battle.id,
      result,
      captured,
      fp_spent: fpCost,
      fp_earned: fpReward,
      new_balance: updated?.fp_balance || 0,
      message: result === 'victory'
        ? `🎯 ${enemy.name} captured! +${fpReward} FP earned!`
        : result === 'defeat'
        ? `💀 Defeated. +${fpReward} FP consolation`
        : `🏃 You fled the battle`,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/battles error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// =============================================================================
// GET /api/battles
// Returns recent battles for the current player
// =============================================================================
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    const limit = Math.min(50, parseInt(req.nextUrl.searchParams.get('limit') || '20'))
    const { data: battles, error } = await admin
      .from('battles')
      .select('id, enemy_type, result, fp_spent, fp_earned, created_at')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    return NextResponse.json({ battles })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { getEnemyById } from '@/config/enemies'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'

const CAPTURE_RATES = { common: 0.75, rare: 0.40, legendary: 0.15 }
const CAPTURE_COSTS = { common: 15, rare: 30, legendary: 75 }

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (rateLimited(`capture:${userId}`, 15, 60_000)) return rateLimitResponse()

    const admin = createSupabaseAdminClient()
    const { enemy_id, battle_id } = await req.json()

    const enemy = getEnemyById(enemy_id)
    if (!enemy) return NextResponse.json({ error: 'Invalid enemy' }, { status: 400 })

    const { data: profile } = await admin
      .from('profiles')
      .select('id, total_captures')
      .eq('clerk_user_id', userId)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const cost = CAPTURE_COSTS[enemy.tier]

    // Duplicates are allowed — collect as many of each character as you
    // want; extras can be sold back for FP from the Collection screen

    // Atomic spend — fails (raises INSUFFICIENT_FP) if the balance can't cover
    // the cost, so concurrent captures can't overdraw. Never read-modify-write.
    const { error: spendErr } = await admin.rpc('spend_fp', {
      p_profile_id: profile.id, p_amount: cost,
      p_type: 'capture', p_reference_type: 'enemy',
      p_description: `Capture attempt: ${enemy.name}`,
    })
    if (spendErr) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP' }, { status: 400 })
    }

    // Roll capture chance
    const rate = CAPTURE_RATES[enemy.tier]
    const success = Math.random() < rate

    if (success) {
      await admin.from('captured_characters').insert({
        profile_id: profile.id,
        enemy_id: enemy.id,
        enemy_name: enemy.name,
        enemy_tier: enemy.tier,
        enemy_image: enemy.image,
        enemy_party: enemy.party,
        battle_id: battle_id || null,
      })

      await admin
        .from('profiles')
        .update({ total_captures: (profile.total_captures || 0) + 1 })
        .eq('id', profile.id)
    }

    return NextResponse.json({ captured: success, cost })

  } catch (err: any) {
    console.error('Capture error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
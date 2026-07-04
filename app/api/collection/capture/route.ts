import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { getEnemyById } from '@/config/enemies'

const CAPTURE_RATES = { common: 0.75, rare: 0.40, legendary: 0.15 }
const CAPTURE_COSTS = { common: 15, rare: 30, legendary: 75 }

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createSupabaseAdminClient()
    const { enemy_id, battle_id } = await req.json()

    const enemy = getEnemyById(enemy_id)
    if (!enemy) return NextResponse.json({ error: 'Invalid enemy' }, { status: 400 })

    const { data: profile } = await admin
      .from('profiles')
      .select('id, fp_balance, total_captures')
      .eq('clerk_user_id', userId)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const cost = CAPTURE_COSTS[enemy.tier]
    if (profile.fp_balance < cost) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP' }, { status: 400 })
    }

    // Check already captured
    const { data: existing } = await admin
      .from('captured_characters')
      .select('id')
      .eq('profile_id', profile.id)
      .eq('enemy_id', enemy_id)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Already captured', captured: false }, { status: 400 })
    }

    // Spend FP
    await admin
      .from('profiles')
      .update({ fp_balance: profile.fp_balance - cost })
      .eq('id', profile.id)

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
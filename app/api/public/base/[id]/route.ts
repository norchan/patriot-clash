import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse, clientIp } from '@/lib/ratelimit'
import { fighterLevel } from '@/lib/fighter'
import { defenseScore, botDefenseScore, botBase } from '@/config/house'

// R3: PUBLIC base payload for the visit page (/base/[id]) — the landing
// behind the share poster's link. SAFE SUBSET ONLY: yard layout + brag stats.
// No FP balances, no shield timing, no clerk ids, nothing actionable.
// Bots derive their yard exactly like the raid finder does, so a shared bot
// base renders the same yard a raider would meet.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (rateLimited(`pubbase:${clientIp(req)}`, 30, 60_000)) return rateLimitResponse()
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const admin = createSupabaseAdminClient()
    const { data: p } = await admin.from('profiles')
      .select('id, username, party, total_battles_won, clerk_user_id, hq_level, house_trophies, print_shop_pad')
      .eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const level = fighterLevel(p.total_battles_won ?? 0)
    const isBot = p.clerk_user_id?.startsWith('bot') ?? false

    if (isBot) {
      const base = botBase(p.id, level)
      return NextResponse.json({
        username: p.username, party: p.party, level,
        trophies: p.house_trophies ?? 0,
        base: { ...base, print_shop_pad: 15 },
        defense: botDefenseScore(base),
      })
    }

    const { data: rows } = await admin.from('house_buildings')
      .select('pad, type, level, facing, damaged_until')
      .eq('profile_id', id)
    const buildings = (rows ?? []).map((b: any) => ({
      pad: b.pad, type: b.type, level: b.level, facing: b.facing,
      damaged: !!b.damaged_until && new Date(b.damaged_until) > new Date(),
    }))
    const baseLevel = Math.max(1, Math.min(5, p.hq_level ?? 1))
    return NextResponse.json({
      username: p.username, party: p.party, level,
      trophies: p.house_trophies ?? 0,
      base: { baseLevel, padsOpen: 6, buildings, print_shop_pad: p.print_shop_pad ?? undefined },
      defense: defenseScore(buildings, baseLevel),
    })
  } catch (err) {
    console.error('GET /api/public/base error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

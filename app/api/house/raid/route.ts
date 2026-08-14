import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { fighterLevel } from '@/lib/fighter'
import { notify } from '@/lib/notify'
import {
  RAID_COST, RAID_DAILY_CAP, BOT_LOOT_DAILY_CAP, RAID_PAIR_COOLDOWN_HOURS,
  RAID_SHIELD_HOURS, RAID_LOOT_PCT, raidLootAbsCap, raidDamagePct,
  defenseScore, botDefenseScore, trophiesFor, botBase,
  REPAIR_FENCE_SECS_PER_LEVEL, REPAIR_BUILDING_SECS_PER_LEVEL,
} from '@/config/house'
import { armyPower, armyBonus, casualtyPlan, troopById } from '@/config/troops'

/** The attacker's army as {troop_type: count}. Settles the training queue
 *  first so units that finished while the player was away can fight. */
async function attackerArmy(admin: any, profileId: string): Promise<Record<string, number>> {
  // NOTE: supabase query builders are thenables WITHOUT .catch — chaining
  // .catch() onto rpc() throws "catch is not a function" at runtime (broke
  // every raid on 2026-08-09). Errors surface in the result object anyway;
  // a failed settle just means the army reads slightly stale. try/catch
  // guards the await itself.
  try { await admin.rpc('troops_settle', { p_profile_id: profileId }) } catch {}
  const { data } = await admin.from('house_troops')
    .select('troop_type, count').eq('profile_id', profileId).gt('count', 0)
  const counts: Record<string, number> = {}
  for (const r of data ?? []) counts[r.troop_type] = r.count
  return counts
}

// PERSONAL BASE RAIDS (Phase 2). GET finds a target; POST resolves the raid.
// The outcome is decided entirely HERE + in the raid_house SQL function — the
// client's "smash their buildings" screen is choreography for numbers that
// are already settled, the same pattern as the siege theater.

/** Level + derived base for any profile (bots derive, humans read rows). */
async function defenderInfo(admin: any, p: { id: string; clerk_user_id: string; total_battles_won: number; hq_level?: number }) {
  const isBot = p.clerk_user_id?.startsWith('bot') ?? false
  const level = fighterLevel(p.total_battles_won ?? 0)
  if (isBot) {
    const base = botBase(p.id, level)
    return { isBot, level, base: { ...base, print_shop_pad: 15 }, defense: botDefenseScore(base), baseLevel: base.baseLevel }
  }
  const { data: rows } = await admin.from('house_buildings')
    .select('pad, type, level, facing, damaged_until').eq('profile_id', p.id)
  // damaged buildings (still under their repair countdown) don't defend and
  // aren't targets in the theater — they're already rubble
  const buildings = (rows ?? []).map((b: any) => ({
    pad: b.pad, type: b.type, level: b.level, facing: b.facing,
    damaged: !!b.damaged_until && new Date(b.damaged_until) > new Date(),
  }))
  // the HOUSE level IS the human base level — upgrading it raises defense
  const baseLevel = Math.max(1, Math.min(5, p.hq_level ?? 1))
  return {
    isBot, level, baseLevel,
    base: { baseLevel, padsOpen: 6, buildings },
    defense: defenseScore(buildings, baseLevel),
  }
}

// GET /api/house/raid → a raidable target with a rendered base + loot forecast
export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()

    // Humans first when any are raidable (shield down, not self, has FP) —
    // they're the real game; bots fill the gap until Michael retires them.
    const { data: humans } = await admin.from('profiles')
      .select('id, username, party, total_battles_won, fp_balance, clerk_user_id, house_shield_until, hq_level')
      .not('clerk_user_id', 'like', 'bot%')
      .neq('id', profile.id)
      .gte('fp_balance', 200)
      .limit(25)
    const rawHumans = (humans ?? []).filter(h =>
      !h.house_shield_until || new Date(h.house_shield_until) <= new Date())

    let target: any = null
    if (rawHumans.length && Math.random() < 0.35) {
      target = rawHumans[Math.floor(Math.random() * rawHumans.length)]
    } else {
      // random page into the big bot table — cheap and uniform enough
      const { count } = await admin.from('profiles')
        .select('id', { count: 'exact', head: true })
        .like('clerk_user_id', 'bot%').gte('fp_balance', 200)
      const n = count ?? 0
      if (n > 0) {
        const off = Math.floor(Math.random() * n)
        const { data: bots } = await admin.from('profiles')
          .select('id, username, party, total_battles_won, fp_balance, clerk_user_id')
          .like('clerk_user_id', 'bot%').gte('fp_balance', 200)
          .range(off, off)
        target = bots?.[0] ?? null
      }
      if (!target && rawHumans.length) target = rawHumans[0]
    }
    if (!target) return NextResponse.json({ error: 'No raidable bases right now' }, { status: 404 })

    const info = await defenderInfo(admin, target)
    const pot = Math.floor(Math.min(target.fp_balance * RAID_LOOT_PCT, raidLootAbsCap(info.baseLevel)))
    const counts = await attackerArmy(admin, profile.id)
    const power = armyPower(counts)
    return NextResponse.json({
      army: { total: Object.values(counts).reduce((s, n) => s + n, 0), power, bonus: armyBonus(power) },
      target: {
        id: target.id, username: target.username, party: target.party,
        level: info.level, base_level: info.baseLevel, base: info.base,
      },
      cost: RAID_COST,
      // forecast band, not a promise — damage% decides the real number
      loot_min: Math.floor(pot * 0.35),
      loot_max: pot,
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/house/raid error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/house/raid { defender_id } → resolve
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`raid:${profile.id}`, 12, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()

    const { defender_id } = await req.json()
    if (typeof defender_id !== 'string' || !defender_id) {
      return NextResponse.json({ error: 'defender_id required' }, { status: 400 })
    }
    const { data: defender } = await admin.from('profiles')
      .select('id, username, party, total_battles_won, fp_balance, clerk_user_id, hq_level')
      .eq('id', defender_id).maybeSingle()
    if (!defender) return NextResponse.json({ error: 'Base not found' }, { status: 404 })

    const info = await defenderInfo(admin, defender)
    const attackerLevel = fighterLevel(profile.total_battles_won ?? 0)
    // TROOPS (Michael 2026-08-04): raids are FOUGHT BY THE ARMY — no troops,
    // no raid. Their power raises the attack side of the damage roll.
    const counts = await attackerArmy(admin, profile.id)
    if (Object.keys(counts).length === 0) {
      return NextResponse.json({ error: 'NEED_TROOPS', message: 'Your troops do the fighting — train some at your Barracks first' }, { status: 400 })
    }
    const bonus = armyBonus(armyPower(counts))
    const damage = raidDamagePct(attackerLevel + bonus, info.defense, Math.random())
    const trophies = trophiesFor(damage)

    const { data, error } = await admin.rpc('raid_house', {
      p_attacker: profile.id,
      p_defender: defender.id,
      p_defender_bot: info.isBot,
      p_entry: RAID_COST,
      p_damage_pct: damage,
      p_loot_pct: RAID_LOOT_PCT,
      p_loot_abs_cap: raidLootAbsCap(info.baseLevel),
      p_daily_cap: RAID_DAILY_CAP,
      p_bot_daily_loot_cap: BOT_LOOT_DAILY_CAP,
      p_pair_cooldown_hours: RAID_PAIR_COOLDOWN_HOURS,
      p_shield_hours: RAID_SHIELD_HOURS,
      p_trophies: trophies,
    })
    if (error) {
      const m = error.message
      const friendly: Record<string, [number, string]> = {
        RAID_DAILY_CAP: [429, `You're out of raids for today (${RAID_DAILY_CAP}/day)`],
        RAID_PAIR_COOLDOWN: [429, 'You already hit that base today — pick another'],
        RAID_SHIELDED: [409, 'Their shield is up — they were raided recently'],
        INSUFFICIENT_FP: [400, `Need ${RAID_COST} FP to launch a raid`],
        RAID_SELF: [400, "You can't raid your own base"],
      }
      for (const key of Object.keys(friendly)) {
        if (m.includes(key)) {
          const [status, msg] = friendly[key]
          return NextResponse.json({ error: key, message: msg }, { status })
        }
      }
      console.error('raid_house failed:', error)
      return NextResponse.json({ error: 'Raid failed' }, { status: 500 })
    }

    const row = Array.isArray(data) ? data[0] : data
    const loot = row?.loot ?? 0

    // the defender's base carries SCARS (Michael 2026-08-09): buildings enter
    // their repair countdowns — fences mend faster, the doberman is exempt.
    // Bots derive their bases, nothing to mark.
    if (!info.isBot) {
      const { error: dmgErr } = await admin.rpc('damage_base', {
        p_profile_id: defender.id,
        p_fence_secs_per_level: REPAIR_FENCE_SECS_PER_LEVEL,
        p_building_secs_per_level: REPAIR_BUILDING_SECS_PER_LEVEL,
      })
      if (dmgErr) console.error('damage_base failed (scars skipped):', dmgErr)
    }

    // casualties: defenses bit back — tanks fall first, support keeps the
    // rate down (config/troops.ts). Fire-and-check: a failure here can only
    // UNDER-charge the player, never double-charge.
    const losses = casualtyPlan(counts, info.defense)
    if (Object.keys(losses).length) {
      const { error: lossErr } = await admin.rpc('consume_troops', {
        p_profile_id: profile.id, p_losses: losses,
      })
      if (lossErr) console.error('consume_troops failed (losses skipped):', lossErr)
    }

    if (!info.isBot) {
      await notify(admin, {
        profileId: defender.id,
        type: 'pvp',
        title: `🏚️ ${profile.username} raided your base!`,
        body: loot > 0 ? `They made off with ${loot} FP. Your shield is up for ${RAID_SHIELD_HOURS}h.` : `Your defenses held — nothing was taken. Shield up for ${RAID_SHIELD_HOURS}h.`,
        link: '/hq',
        dedupeUnreadLink: false,
      }).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      damage_pct: damage,
      loot,
      trophies: row?.trophies ?? trophies,
      cost: RAID_COST,
      army: {
        bonus,
        // the roster that marched — the client's assault theater animates them
        marched: Object.entries(counts).map(([id, n]) => ({ id, n })),
        losses: Object.entries(losses).map(([id, n]) => ({ id, n, name: troopById(id)?.name ?? id, emoji: troopById(id)?.emoji ?? '💥' })),
      },
      base: info.base, // the yard the client gets to smash
      defender: { username: defender.username, party: defender.party, level: info.level, base_level: info.baseLevel },
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/house/raid error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

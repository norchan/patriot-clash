import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { sanitizeFighter, fighterLevel } from '@/lib/fighter'
import { isValidHead, headMeta } from '@/config/heads'
import { isValidFighter, fighterAllowedForParty, fighterUnlockedAtLevel, fighterMeta } from '@/config/fighters'

// PATCH /api/profile/settings — update player preferences
export async function PATCH(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const body = await req.json()

    const allowed = ['allow_pvp_messages', 'allow_messages', 'show_party', 'location_fuzz']
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }
    if ('gender' in body) {
      if (body.gender !== 'male' && body.gender !== 'female' && body.gender !== null) {
        return NextResponse.json({ error: 'Invalid gender' }, { status: 400 })
      }
      updates.gender = body.gender
    }
    // Age — shown on the profile's Me menu; null clears it
    if ('age' in body) {
      const a = body.age
      if (a !== null && (!Number.isInteger(a) || a < 13 || a > 120)) {
        return NextResponse.json({ error: 'Invalid age' }, { status: 400 })
      }
      updates.age = a
    }
    if ('map_visibility' in body) {
      if (!['everyone', 'hide_from_republicans', 'hide_from_democrats', 'nobody'].includes(body.map_visibility)) {
        return NextResponse.json({ error: 'Invalid map visibility' }, { status: 400 })
      }
      updates.map_visibility = body.map_visibility
    }
    // Notification preferences: { dm?: bool, pvp?: bool, social?: bool } —
    // merged over the existing prefs; false mutes that type
    if ('notification_prefs' in body && typeof body.notification_prefs === 'object' && body.notification_prefs) {
      const clean: Record<string, boolean> = { ...((profile as any).notification_prefs ?? {}) }
      for (const k of ['dm', 'pvp', 'social', 'system', 'push']) {
        if (k in body.notification_prefs) clean[k] = !!body.notification_prefs[k]
      }
      updates.notification_prefs = clean
    }
    // Fighter designs are validated against the allowed option sets
    if ('fighter' in body) {
      updates.fighter = sanitizeFighter(body.fighter, profile.id)
    }
    // Chosen 3D PvP fighter BODY (party blue/red kit applied automatically)
    if ('pvp_fighter' in body) {
      // Validated against the shared catalog (config/fighters.ts) so sprite
      // fighters work, and party-locked ones stay locked server-side.
      if (!isValidFighter(body.pvp_fighter)) {
        return NextResponse.json({ error: 'Invalid fighter' }, { status: 400 })
      }
      if (!fighterAllowedForParty(body.pvp_fighter, profile.party)) {
        return NextResponse.json({ error: 'That fighter belongs to the other party' }, { status: 400 })
      }
      // LEVEL GATE (Michael 2026-07-28): enforced here so a locked fighter
      // can't be set by calling the endpoint directly. Existing saves are
      // GRANDFATHERED — we never reset a profile, we only block NEW saves of
      // fighters the player hasn't earned yet.
      const myLevel = fighterLevel((profile as any).total_battles_won ?? 0)
      // Re-saving the fighter you ALREADY have is not a new save — this is what
      // makes grandfathering work end to end (otherwise the picker's Save button
      // would reject a player's own current fighter).
      const keepingCurrent = body.pvp_fighter === (profile as any).pvp_fighter
      if (!keepingCurrent && !fighterUnlockedAtLevel(body.pvp_fighter, myLevel)) {
        const f = fighterMeta(body.pvp_fighter)
        return NextResponse.json(
          { error: `${f?.label ?? 'That fighter'} unlocks at level ${f?.minLevel ?? 1} — you're level ${myLevel}` },
          { status: 400 })
      }
      updates.pvp_fighter = body.pvp_fighter
    }
    // Website — one optional http(s) link shown atop the profile; null clears
    if ('website_url' in body) {
      const w = body.website_url
      if (w !== null) {
        if (typeof w !== 'string' || w.length > 200) {
          return NextResponse.json({ error: 'Invalid website' }, { status: 400 })
        }
        let u: URL
        try { u = new URL(w) } catch { return NextResponse.json({ error: 'Enter a full URL (https://…)' }, { status: 400 }) }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return NextResponse.json({ error: 'Only http(s) links are allowed' }, { status: 400 })
        }
        updates.website_url = u.toString()
      } else {
        updates.website_url = null
      }
    }
    // About Me — free text (links/photo URLs allowed), capped; empty clears it
    if ('about_me' in body) {
      if (body.about_me !== null && typeof body.about_me !== 'string') {
        return NextResponse.json({ error: 'Invalid about me' }, { status: 400 })
      }
      const text = (body.about_me ?? '').trim()
      if (text.length > 600) {
        return NextResponse.json({ error: 'About me is limited to 600 characters' }, { status: 400 })
      }
      updates.about_me = text || null
    }
    // Chosen fighter HEAD (null = the body's own head); validated vs the
    // catalog AND party-gated: Republicans get republican heads, Democrats
    // democrat heads.
    if ('head_id' in body) {
      if (body.head_id !== null) {
        if (!isValidHead(body.head_id)) {
          return NextResponse.json({ error: 'Invalid head' }, { status: 400 })
        }
        const hp = headMeta(body.head_id)?.party
        if (hp && hp !== profile.party) {
          return NextResponse.json({ error: 'That head belongs to the other party' }, { status: 400 })
        }
      }
      updates.head_id = body.head_id
    }

    if ('username' in body) {
      const name = String(body.username ?? '').trim()
      if (name.length < 3 || name.length > 20) {
        return NextResponse.json({ error: 'Name must be 3-20 characters' }, { status: 400 })
      }
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
        return NextResponse.json({ error: 'Letters, numbers, dots, dashes and underscores only' }, { status: 400 })
      }
      if (name.toLowerCase().startsWith('bot_')) {
        return NextResponse.json({ error: 'That name is reserved' }, { status: 400 })
      }
      if (name !== profile.username) {
        // Case-insensitive pre-check; the UNIQUE index is the real guard
        const { data: taken } = await admin
          .from('profiles')
          .select('id')
          .ilike('username', name)
          .neq('id', profile.id)
          .maybeSingle()
        if (taken) {
          return NextResponse.json({ error: 'That name is already taken' }, { status: 409 })
        }
      }
      updates.username = name
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { error } = await admin
      .from('profiles')
      .update(updates)
      .eq('id', profile.id)

    if (error) {
      // 23505 = unique violation: someone claimed the name in between
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'That name was just taken' }, { status: 409 })
      }
      throw error
    }

    // The map reads usernames from a denormalized copy — keep it in sync
    if (updates.username) {
      await admin.from('player_locations')
        .update({ username: updates.username })
        .eq('profile_id', profile.id)
    }

    return NextResponse.json({ success: true, updated: updates })

  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

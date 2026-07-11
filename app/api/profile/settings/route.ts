import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { sanitizeFighter } from '@/lib/fighter'

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
      for (const k of ['dm', 'pvp', 'social', 'system']) {
        if (k in body.notification_prefs) clean[k] = !!body.notification_prefs[k]
      }
      updates.notification_prefs = clean
    }
    // Fighter designs are validated against the allowed option sets
    if ('fighter' in body) {
      updates.fighter = sanitizeFighter(body.fighter, profile.id)
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

import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const COOLDOWN_DAYS = 30
const DAY_MS = 24 * 3600 * 1000

// GET — when the player is next allowed to switch parties.
export async function GET() {
  try {
    const profile = await requireProfile()
    const changedAt = (profile as any).party_changed_at
    const last = changedAt ? new Date(changedAt).getTime() : 0
    const nextAllowed = last ? last + COOLDOWN_DAYS * DAY_MS : 0
    const canChange = Date.now() >= nextAllowed
    return NextResponse.json({
      party: profile.party,
      can_change: canChange,
      next_allowed_at: nextAllowed ? new Date(nextAllowed).toISOString() : null,
      days_left: canChange ? 0 : Math.ceil((nextAllowed - Date.now()) / DAY_MS),
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH { party } — switch parties, at most once every 30 days.
export async function PATCH(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { party } = await req.json()

    if (!['democrat', 'republican'].includes(party)) {
      return NextResponse.json({ error: 'Invalid party' }, { status: 400 })
    }
    if (party === profile.party) {
      return NextResponse.json({ error: `You're already a ${party === 'democrat' ? 'Democrat' : 'Republican'}.` }, { status: 400 })
    }

    const changedAt = (profile as any).party_changed_at
    if (changedAt) {
      const nextAllowed = new Date(changedAt).getTime() + COOLDOWN_DAYS * DAY_MS
      if (Date.now() < nextAllowed) {
        const daysLeft = Math.ceil((nextAllowed - Date.now()) / DAY_MS)
        return NextResponse.json(
          { error: `You can switch parties again in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`, days_left: daysLeft },
          { status: 429 },
        )
      }
    }

    // Switch party and leave any clique (cliques are party-bound). Sync the
    // denormalized party on the map's location row too.
    const { error } = await admin
      .from('profiles')
      .update({ party, party_changed_at: new Date().toISOString(), clique_id: null })
      .eq('id', profile.id)
    if (error) throw error

    await admin.from('player_locations').update({ party }).eq('profile_id', profile.id)

    return NextResponse.json({ success: true, party })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

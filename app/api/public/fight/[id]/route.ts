import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fighterLevel } from '@/lib/fighter'
import { headMeta } from '@/config/heads'
import { notify } from '@/lib/notify'

// PUBLIC guest-fight data (no auth): a challenge-SHAPED object for the fight
// screen's guest mode (/battle/pvp?guest=1&vs=<id>). The link owner is cast
// as an AI-driven defender at their real level with their real fighter, so a
// visitor with no account fights them in the browser before ever signing up.

function pickFighter(id: string, party?: string | null): string {
  const pool = party === 'democrat'
    ? ['fighter1', 'fighter2', 'fighter3', 'fighter4', 'fighter5', 'fighter6']
    : ['fighter1', 'fighter2', 'fighter3', 'fighter4', 'fighter6']
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return pool[Math.abs(h) % pool.length]
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const admin = createSupabaseAdminClient()

    const { data: owner } = await admin
      .from('profiles')
      .select('id, username, party, fighter, pvp_fighter, head_id, total_battles_won')
      .eq('id', id)
      .maybeSingle()
    if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Heads-up push to the link owner: someone's fighting their fighter
    // (Michael 2026-07-23 — he wants to KNOW when the link gets bites).
    // Throttled to one ping per 30 minutes so reloads/rematches don't spam.
    try {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const { data: recent } = await admin
        .from('notifications')
        .select('id')
        .eq('profile_id', owner.id)
        .eq('type', 'pvp')
        .like('title', '%took a swing%')
        .gte('created_at', since)
        .limit(1)
      if (!recent?.length) {
        // MUST await: serverless freezes at response time and kills
        // fire-and-forget promises — un-awaited notify() never lands.
        // Purely informational (AI demo fight) — nothing to join, so the
        // link goes home, NOT to /arena (Michael kept landing there
        // expecting a fight to enter)
        await notify(admin, {
          profileId: owner.id,
          type: 'pvp',
          title: '👀 Someone tried your fighter on autopilot',
          body: 'A visitor from your fight link fought your fighter\'s AI. If they sign up, you\'ll get called out for real — nothing to do right now.',
          link: '/',
        })
      }
    } catch { /* never block the fight on the ping */ }

    // party-gate the head like the real fight route does
    const headParty = owner.head_id ? headMeta(owner.head_id)?.party : null
    const defenderHead = headParty && headParty !== owner.party ? null : owner.head_id

    // the guest wears the OPPOSITE kit so the two corners read instantly
    const guestParty = owner.party === 'democrat' ? 'republican' : 'democrat'

    return NextResponse.json({
      id: `guest-${owner.id}`,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      challenger_id: 'guest',
      defender_id: owner.id,
      challenger_username: 'You',
      defender_username: owner.username,
      challenger_party: guestParty,
      defender_party: owner.party,
      fp_stake: 0,
      winner_id: null,
      challenger_level: 1,
      defender_level: fighterLevel(owner.total_battles_won ?? 0),
      challenger_fighter: null,
      defender_fighter: owner.fighter ?? null,
      challenger_pvp_fighter: 'fighter1',
      defender_pvp_fighter: owner.pvp_fighter ?? pickFighter(owner.id, owner.party),
      challenger_head_id: null,
      defender_head_id: defenderHead,
      challenger_is_bot: false,
      defender_is_bot: true, // drives the fight page's local-AI opponent path
    })
  } catch (err) {
    console.error('GET /api/public/fight error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

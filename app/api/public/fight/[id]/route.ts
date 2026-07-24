import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fighterLevel } from '@/lib/fighter'
import { headMeta } from '@/config/heads'

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

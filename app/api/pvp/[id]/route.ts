import { NextRequest, NextResponse } from 'next/server'
import { headMeta, HEADS } from '@/config/heads'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fighterLevel, sanitizeFighter } from '@/lib/fighter'
import { notify } from '@/lib/notify'

// Deterministic 3D fighter for players who haven't picked one (incl. bots).
// fighter5 is rainbow — Democrat-only.
// party-gate: a saved head from the other party never renders in a fight
// (heads catalog imported below)
function partyHead(headId?: string | null, party?: string | null): string | null {
  if (!headId) return null
  const hp = headMeta(headId)?.party
  return hp && hp !== party ? null : headId
}

// 75% of bots wear a bobblehead (Michael) — deterministic per bot id so a
// bot keeps the same face between fights, party-appropriate, well mixed.
function botHead(id: string, party?: string | null): string | null {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(33, h) + id.charCodeAt(i)) | 0
  if (Math.abs(h) % 100 >= 75) return null // the bare-headed 25%
  const pool = HEADS.filter(x => !x.party || x.party === party)
  if (!pool.length) return null
  return pool[Math.abs(Math.imul(h, 2654435761)) % pool.length].id
}

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
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id } = await params

    const { data: challenge, error } = await admin
      .from('pvp_challenges')
      .select('*')
      .eq('id', id)
      .or(`challenger_id.eq.${profile.id},defender_id.eq.${profile.id}`)
      .single()

    if (error || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status === 'pending' && new Date(challenge.expires_at) < new Date()) {
      await admin.from('pvp_challenges').update({ status: 'expired' }).eq('id', id)
      return NextResponse.json({ ...challenge, status: 'expired' })
    }

    // Armed fights the challenger walked away from get cancelled — no FP
    // ever moved, so nothing to unwind
    if (challenge.status === 'accepted' && challenge.accepted_at
      && Date.now() - new Date(challenge.accepted_at).getTime() > 10 * 60_000) {
      await admin.from('pvp_challenges').update({ status: 'cancelled' }).eq('id', id).eq('status', 'accepted')
      return NextResponse.json({ ...challenge, status: 'cancelled' })
    }

    // Defender just stepped into the ring for the first time → tell the
    // challenger (push included via notify): "they're ready — tap to fight".
    // The atomic is-null guard means exactly one ping per challenge, and only
    // for human challengers who might be off the app (Michael 2026-07-23).
    if (challenge.status === 'accepted'
      && profile.id === challenge.defender_id
      && !challenge.defender_ready_at) {
      const { data: claimed } = await admin
        .from('pvp_challenges')
        .update({ defender_ready_at: new Date().toISOString() })
        .eq('id', id)
        .is('defender_ready_at', null)
        .select('id')
        .maybeSingle()
      if (claimed) {
        notify(admin, {
          profileId: challenge.challenger_id,
          type: 'pvp',
          title: `🥊 ${challenge.defender_username} answered your challenge!`,
          body: 'They\'re in the ring waiting — tap to fight!',
          link: `/battle/pvp?id=${id}`,
        }).catch(() => {})
      }
    }

    // Usernames/parties are denormalized onto the row at insert time — no
    // extra profile queries needed (this route is polled every 3s)...
    // EXCEPT armed/settled fights: the fight screen needs both fighters'
    // levels and designs — including AFTER settlement (the post-fight
    // refetch previously dropped the designs, morphing the winner into a
    // random default fighter at the victory screen)
    if (['accepted', 'resolving', 'completed'].includes(challenge.status)) {
      const [{ data: c }, { data: d }] = await Promise.all([
        admin.from('profiles').select('id, total_battles_won, fighter, pvp_fighter, head_id, party, clerk_user_id').eq('id', challenge.challenger_id).single(),
        admin.from('profiles').select('id, total_battles_won, fighter, pvp_fighter, head_id, party, clerk_user_id').eq('id', challenge.defender_id).single(),
      ])
      return NextResponse.json({
        ...challenge,
        challenger_level: fighterLevel(c?.total_battles_won ?? 0),
        defender_level: fighterLevel(d?.total_battles_won ?? 0),
        challenger_fighter: sanitizeFighter(c?.fighter, challenge.challenger_id),
        defender_fighter: sanitizeFighter(d?.fighter, challenge.defender_id),
        // chosen 3D fighter (falls back deterministically if unset, e.g. bots)
        challenger_pvp_fighter: c?.pvp_fighter ?? pickFighter(challenge.challenger_id, c?.party),
        defender_pvp_fighter: d?.pvp_fighter ?? pickFighter(challenge.defender_id, d?.party),
        challenger_head_id: partyHead(c?.head_id, c?.party)
          ?? (c?.clerk_user_id?.startsWith('bot_') ? botHead(challenge.challenger_id, c?.party) : null),
        defender_head_id: partyHead(d?.head_id, d?.party)
          ?? (d?.clerk_user_id?.startsWith('bot_') ? botHead(challenge.defender_id, d?.party) : null),
        challenger_is_bot: !!c?.clerk_user_id?.startsWith('bot_'),
        defender_is_bot: !!d?.clerk_user_id?.startsWith('bot_'),
      })
    }

    return NextResponse.json(challenge)

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/pvp/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

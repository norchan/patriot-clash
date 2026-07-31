import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { fpPack } from '@/config/fp-packs'
import { verifyPlayPurchase } from '@/lib/play-billing'

// POST /api/shop/play-verify { product_id, purchase_token }
//
// The Android app buys through Google Play, then sends the purchase token
// here. This route is the ONLY thing that grants FP for a Play purchase, and
// it grants it exactly once.
//
// Order of operations matters and is deliberate:
//   1. authenticate the player
//   2. look the pack up in OUR catalog (never trust a client-sent FP amount)
//   3. ask Google whether the token is a real, completed purchase
//   4. claim the token by INSERTing it — the primary key is what makes a
//      replay impossible, so the claim happens BEFORE the FP is granted
//   5. grant the FP
//
// Claiming before granting means a crash between the two loses a grant, which
// is recoverable by support. Granting before claiming would mean a retry pays
// twice, which is not recoverable — it's already money out the door.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`playverify:${profile.id}`, 20, 60_000)) return rateLimitResponse()

    const { product_id, purchase_token } = await req.json()
    if (typeof product_id !== 'string' || typeof purchase_token !== 'string' || !purchase_token) {
      return NextResponse.json({ error: 'product_id and purchase_token required' }, { status: 400 })
    }

    // FP amount comes from OUR catalog, never from the request body
    const pack = fpPack(product_id)
    if (!pack) return NextResponse.json({ error: 'Unknown product' }, { status: 400 })

    const verdict = await verifyPlayPurchase(product_id, purchase_token)
    if (!verdict.ok) {
      if (verdict.reason === 'no_service_account') {
        console.error('play-verify: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is missing — cannot verify purchases')
        return NextResponse.json({ error: 'Purchases are temporarily unavailable' }, { status: 503 })
      }
      console.warn('play-verify rejected:', verdict.reason, product_id, profile.id)
      return NextResponse.json({ error: 'Purchase could not be verified' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    // Claim the token. A duplicate key here means this purchase was already
    // granted — that's a SUCCESS for the caller (their FP is in the account),
    // not an error, so the app can safely retry and still finish cleanly.
    const { error: claimErr } = await admin.from('play_purchases').insert({
      purchase_token,
      profile_id: profile.id,
      product_id,
      fp_granted: pack.fp,
      order_id: verdict.orderId ?? null,
    })
    if (claimErr) {
      if ((claimErr as any).code === '23505') {
        return NextResponse.json({ ok: true, fp: pack.fp, already: true })
      }
      console.error('play-verify: could not claim token', claimErr)
      return NextResponse.json({ error: 'Could not record purchase' }, { status: 500 })
    }

    const { error: grantErr } = await admin.rpc('grant_fp', {
      p_profile_id: profile.id,
      p_amount: pack.fp,
      p_type: 'purchase',
      p_reference_type: 'play_purchase',
      p_description: `${pack.name} (Google Play)`,
    })
    if (grantErr) {
      // The token stays claimed on purpose — releasing it would let a retry
      // double-grant. Loud log so a real purchase can be settled by hand.
      console.error('play-verify: PAID BUT NOT GRANTED', {
        profile: profile.id, product_id, purchase_token, order: verdict.orderId, err: grantErr,
      })
      return NextResponse.json({ error: 'Purchase recorded but FP grant failed — contact support' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, fp: pack.fp })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/shop/play-verify error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

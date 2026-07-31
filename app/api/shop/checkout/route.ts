import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fpPack } from '@/config/fp-packs'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
})

// FP amounts come from the shared catalog so Stripe and Google Play can never
// grant different FP for the same pack; only the Stripe price id lives here.
const packFor = (id: string) => {
  const p = fpPack(id)
  if (!p) return null
  return { fp: p.fp, name: p.name, priceId: process.env[p.stripeEnv] }
}

// =============================================================================
// POST /api/shop/checkout
// Creates a Stripe Checkout Session for an FP pack purchase.
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()

    const body = await req.json()
    const { pack_id } = body

    const pack = packFor(pack_id)
    if (!pack) {
      return NextResponse.json({ error: 'Invalid pack' }, { status: 400 })
    }
    if (!pack.priceId) {
      console.error(`shop/checkout: missing Stripe price env for ${pack_id}`)
      return NextResponse.json({ error: 'That pack is not available right now' }, { status: 503 })
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: pack.priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/shop`,
      metadata: {
        profile_id: profile.id,
        pack_id,
        fp_amount: pack.fp.toString(),
        clerk_user_id: profile.clerk_user_id,
      },
      customer_email: undefined, // Clerk handles email
    })

    // Record pending purchase
    const admin = createSupabaseAdminClient()
    await admin.from('stripe_purchases').insert({
      profile_id: profile.id,
      stripe_payment_id: session.id,
      stripe_status: 'pending',
      amount_cents: session.amount_total || 0,
      fp_granted: pack.fp,
      fulfilled: false,
    })

    return NextResponse.json({
      checkout_url: session.url,
      session_id: session.id,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/shop/checkout error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

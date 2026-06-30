import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil',
})

// FP pack definitions — must match Stripe products
const FP_PACKS: Record<string, { fp: number; priceId: string; name: string }> = {
  fp_100: {
    fp: 100,
    priceId: process.env.STRIPE_PRICE_FP_100!,
    name: 'Starter Pack'
  },
  fp_600: {
    fp: 600,
    priceId: process.env.STRIPE_PRICE_FP_600!,
    name: 'Value Pack'
  },
  fp_1400: {
    fp: 1400,
    priceId: process.env.STRIPE_PRICE_FP_1400!,
    name: 'Power Pack'
  },
  fp_3200: {
    fp: 3200,
    priceId: process.env.STRIPE_PRICE_FP_3200!,
    name: 'Elite Pack'
  },
  fp_32000: {
    fp: 32000,
    priceId: process.env.STRIPE_PRICE_FP_32000!,
    name: 'Super Pack'
  },
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

    const pack = FP_PACKS[pack_id]
    if (!pack) {
      return NextResponse.json({ error: 'Invalid pack' }, { status: 400 })
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

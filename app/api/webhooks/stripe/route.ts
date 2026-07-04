import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
})

// =============================================================================
// POST /api/webhooks/stripe
// Handles Stripe events. Fulfills FP on checkout.session.completed.
// Register this URL in Stripe Dashboard → Webhooks:
//   https://politicsgo.app/api/webhooks/stripe
// Events to subscribe: checkout.session.completed, payment_intent.payment_failed
// =============================================================================
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error('Stripe webhook verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session

    // Idempotency check — don't fulfill twice
    const { data: existing } = await admin
      .from('stripe_purchases')
      .select('fulfilled')
      .eq('stripe_payment_id', session.id)
      .single()

    if (existing?.fulfilled) {
      console.log(`Already fulfilled: ${session.id}`)
      return NextResponse.json({ received: true })
    }

    const profileId = session.metadata?.profile_id
    const fpAmount = parseInt(session.metadata?.fp_amount || '0')
    const packId = session.metadata?.pack_id

    if (!profileId || !fpAmount) {
      console.error('Missing metadata in session:', session.id)
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 })
    }

    try {
      // Grant FP to player
      await admin.rpc('grant_fp', {
        p_profile_id: profileId,
        p_amount: fpAmount,
        p_type: 'purchase',
        p_reference_type: 'stripe_payment',
        p_description: `Purchased ${packId}: +${fpAmount} FP`,
        p_stripe_id: session.id,
      })

      // Mark purchase as fulfilled
      await admin
        .from('stripe_purchases')
        .update({
          fulfilled: true,
          stripe_status: 'succeeded',
          webhook_received_at: new Date().toISOString(),
        })
        .eq('stripe_payment_id', session.id)

      // Send notification to player
      const { data: profile } = await admin
        .from('profiles')
        .select('id')
        .eq('id', profileId)
        .single()

      if (profile) {
        await admin.from('notification_queue').insert({
          profile_id: profileId,
          title: '⚡ FP Credited!',
          body: `+${fpAmount} Fighting Points have been added to your account!`,
          data: { type: 'fp_purchased', amount: fpAmount }
        })
      }

      console.log(`✅ Fulfilled ${fpAmount} FP for profile ${profileId}`)

    } catch (err) {
      console.error('Failed to fulfill purchase:', err)
      return NextResponse.json({ error: 'Fulfillment failed' }, { status: 500 })
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    console.log(`Payment failed: ${paymentIntent.id}`)

    await admin
      .from('stripe_purchases')
      .update({ stripe_status: 'failed' })
      .eq('stripe_payment_id', paymentIntent.id)
  }

  return NextResponse.json({ received: true })
}

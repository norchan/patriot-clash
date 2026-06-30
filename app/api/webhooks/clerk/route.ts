import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { WebhookEvent } from '@clerk/nextjs/server'
import { createProfileForUser } from '@/lib/auth'

// =============================================================================
// CLERK WEBHOOK
// Listens for user.created events and creates a matching Supabase profile.
// Register this URL in Clerk Dashboard → Webhooks:
//   https://politicsgo.app/api/webhooks/clerk
// Events to subscribe: user.created, user.updated
// =============================================================================

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET

  if (!WEBHOOK_SECRET) {
    console.error('Missing CLERK_WEBHOOK_SECRET')
    return new Response('Server configuration error', { status: 500 })
  }

  // Verify the webhook signature
  const headerPayload = await headers()
  const svix_id = headerPayload.get('svix-id')
  const svix_timestamp = headerPayload.get('svix-timestamp')
  const svix_signature = headerPayload.get('svix-signature')

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Missing svix headers', { status: 400 })
  }

  const payload = await req.json()
  const body = JSON.stringify(payload)

  const wh = new Webhook(WEBHOOK_SECRET)
  let evt: WebhookEvent

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent
  } catch (err) {
    console.error('Webhook verification failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  // Handle the event
  const { type, data } = evt

  if (type === 'user.created') {
    try {
      const email = data.email_addresses?.[0]?.email_address || ''
      const username = data.username ||
        data.first_name ||
        email.split('@')[0] ||
        `player_${data.id.slice(-6)}`

      await createProfileForUser(data.id, email, username)
      console.log(`✅ Profile created for user: ${data.id}`)
    } catch (err) {
      console.error('Failed to create profile:', err)
      return new Response('Failed to create profile', { status: 500 })
    }
  }

  if (type === 'user.updated') {
    // Handle username/email updates if needed
    console.log(`User updated: ${data.id}`)
  }

  return new Response('OK', { status: 200 })
}

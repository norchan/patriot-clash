import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// POST /api/push/subscribe — save this device's push subscription
// DELETE — remove it (push turned off on this device)
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { endpoint, keys } = await req.json()
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') ||
        typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    }
    // endpoint is unique — a device re-subscribing just re-homes its row
    await admin.from('push_subscriptions').upsert(
      { profile_id: profile.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: 'endpoint' },
    )
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('push subscribe error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { endpoint } = await req.json()
    if (typeof endpoint !== 'string') return NextResponse.json({ error: 'Invalid' }, { status: 400 })
    await admin.from('push_subscriptions').delete()
      .eq('profile_id', profile.id).eq('endpoint', endpoint)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

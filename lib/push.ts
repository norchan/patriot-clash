import webpush from 'web-push'

// Web-push delivery. Called from notify() — every in-app notification also
// goes to any devices the player enabled push on. Dead subscriptions
// (uninstalled PWA, revoked permission) are pruned on 404/410.

let configured = false
function ensureConfigured(): boolean {
  if (configured) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@politicsgo.net', pub, priv)
  configured = true
  return true
}

export async function sendPush(
  admin: any,
  profileId: string,
  payload: { title: string; body?: string; link?: string; tag?: string },
) {
  try {
    if (!ensureConfigured()) return
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('profile_id', profileId)
    if (!subs?.length) return

    const body = JSON.stringify(payload)
    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', s.id)
        }
      }
    }))
  } catch (err) {
    console.error('sendPush failed:', err)
  }
}

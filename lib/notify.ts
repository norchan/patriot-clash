// In-app notifications with per-type preferences. Types: 'dm', 'pvp',
// 'social', 'system'. A pref of false in profiles.notification_prefs mutes
// that type; anything else (including absent) means ON. Bots never get
// notifications. Every notification also goes out via web push to devices
// the player enabled (notification_prefs.push === false mutes push only).

import { sendPush } from '@/lib/push'

export type NotificationType = 'dm' | 'pvp' | 'social' | 'system'

export async function notify(
  admin: any,
  args: {
    profileId: string
    type: NotificationType
    title: string
    body?: string
    link?: string
    dedupeUnreadLink?: boolean // skip if an unread notification already points at link
  }
) {
  try {
    const { data: p } = await admin
      .from('profiles')
      .select('clerk_user_id, notification_prefs')
      .eq('id', args.profileId)
      .maybeSingle()
    if (!p || (p.clerk_user_id ?? '').startsWith('bot')) return
    if ((p.notification_prefs ?? {})[args.type] === false) return

    if (args.dedupeUnreadLink && args.link) {
      const { data: existing } = await admin
        .from('notifications')
        .select('id')
        .eq('profile_id', args.profileId)
        .eq('read', false)
        .eq('link', args.link)
        .limit(1)
      if (existing?.length) return
    }

    await admin.from('notifications').insert({
      profile_id: args.profileId,
      type: args.type,
      title: args.title.slice(0, 120),
      body: args.body?.slice(0, 200) ?? null,
      link: args.link ?? null,
    })

    // mirror to push unless the player muted push specifically
    if ((p.notification_prefs ?? {}).push !== false) {
      await sendPush(admin, args.profileId, {
        title: args.title.slice(0, 120),
        body: args.body?.slice(0, 200),
        link: args.link ?? '/',
        tag: args.dedupeUnreadLink ? args.link ?? undefined : undefined,
      })
    }
  } catch (err) {
    console.error('notify failed:', err)
  }
}

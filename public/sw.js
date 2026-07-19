// PoliticsGo service worker — web push delivery + notification clicks.
// Registered from the notification settings page; push works in the installed
// PWA on Android and on iOS 16.4+ (Add to Home Screen first).

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}
  const title = data.title || 'PoliticsGo'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      data: { link: data.link || '/' },
      tag: data.tag || undefined,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = event.notification.data?.link || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.focus(); if ('navigate' in w) w.navigate(link); return }
      }
      return clients.openWindow(link)
    })
  )
})

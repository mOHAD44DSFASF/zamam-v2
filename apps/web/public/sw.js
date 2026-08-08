// ZAMAM notification service worker.
//
// This does NOT implement Web Push (no VAPID keys / FCM project are configured in this repo, so there is
// no server that can wake a closed tab) — it only handles two things a page that's still open needs:
//   1. Actually displaying a notification via registration.showNotification(), triggered by a message from
//      the page (see lib/pushNotifications.ts's showTaskNotification()).
//   2. Focusing/opening the app to the right task when a shown notification is clicked, including from
//      a background tab, which plain `new Notification()` click handling cannot do reliably across tabs.

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('message', (event) => {
  const { type, title, options } = event.data || {}
  if (type !== 'zamam-show-notification') return
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/dashboard'
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(url)
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})

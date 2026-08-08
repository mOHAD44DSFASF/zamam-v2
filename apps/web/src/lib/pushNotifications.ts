/**
 * Browser notification support for ZAMAM. Scope, honestly: there is no Web Push / FCM infrastructure in
 * this repo (no VAPID keys, no server push endpoint), so this cannot wake a fully closed tab — that would
 * need a provisioned Firebase Cloud Messaging project, which is an infra decision outside this change.
 * What this DOES deliver, for real: a real OS-level Notification while the app has at least one open tab
 * (foregrounded or backgrounded), for every event Part 2 asks for, with click-to-focus into the right task.
 */

const SW_URL = '/sw.js'

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try { return await navigator.serviceWorker.register(SW_URL) }
  catch { return null }
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported'
  try { return await Notification.requestPermission() }
  catch { return Notification.permission }
}

/** Shows a real OS notification for a task-related event and focuses/opens the app to that task on click.
 * Routes through the service worker when one is registered (works even if this tab isn't focused); falls
 * back to a plain `new Notification()` in the same tab otherwise — still real, just less robust. */
export async function showTaskNotification(input: { title: string; body: string; taskId?: string | null; tag?: string }): Promise<void> {
  if (getPermission() !== 'granted') return
  const url = input.taskId ? `/tasks?task=${input.taskId}` : '/notifications'
  const options: NotificationOptions & { data?: unknown } = {
    body: input.body, dir: 'rtl', lang: 'ar', tag: input.tag ?? input.taskId ?? undefined,
    icon: '/favicon.svg', data: { url },
  }
  const registration = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? await navigator.serviceWorker.ready.catch(() => null)
    : null
  if (registration?.active) {
    registration.active.postMessage({ type: 'zamam-show-notification', title: input.title, options })
    return
  }
  try {
    const notification = new Notification(input.title, options)
    notification.onclick = () => { window.focus(); window.location.href = url; notification.close() }
  } catch {
    // Notification constructor throws in some contexts (e.g. within a service worker itself, or certain
    // mobile browsers) even when permission is 'granted' — degrade silently, the in-app bell still works.
  }
}

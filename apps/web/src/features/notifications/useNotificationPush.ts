import { useEffect, useRef } from 'react'
import { notificationClient } from './client'
import { getPermission, showTaskNotification } from '../../lib/pushNotifications'

const POLL_INTERVAL_MS = 45_000

/**
 * Polls the existing /v1/notifications/query endpoint (there's no realtime push transport in this repo —
 * see pushNotifications.ts's scope note) and fires a real OS notification for every unread notification
 * that's new since the last poll. The first poll after mount only seeds the "already seen" set — it must
 * never fire a wall of notifications for everything that was already unread before this feature shipped.
 */
export function useNotificationPush(organizationId: string | null) {
  const seenIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!organizationId) return
    let active = true
    const poll = async () => {
      if (getPermission() !== 'granted') return
      try {
        const snapshot = await notificationClient.load(organizationId, 'unread')
        if (!active) return
        if (!seenIds.current) {
          seenIds.current = new Set(snapshot.notifications.map((n) => n.id))
          return
        }
        for (const notification of snapshot.notifications) {
          if (seenIds.current.has(notification.id)) continue
          seenIds.current.add(notification.id)
          void showTaskNotification({
            title: notification.title,
            body: notification.preview,
            taskId: notification.resourceType === 'task' ? notification.resourceId : null,
            tag: notification.id,
          })
        }
      } catch {
        // A failed poll must never surface as a user-visible error — the in-app bell already handles its
        // own load/error state independently; this is a best-effort background enhancement on top of it.
      }
    }
    void poll()
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => { active = false; clearInterval(interval) }
  }, [organizationId])
}

import { createHash } from 'node:crypto'
import { nextNotificationDeliveryAt, notificationEventPolicy, SCHEMA_VERSION, type NotificationDigest, type OutboxEvent } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type StoredDocument } from '@zamam/firestore'
import type { EventHandler } from './worker.js'

// Moved out of services/functions: this is a worker-side outbox consumer per
// docs/v2/API_AND_BACKEND_ARCHITECTURE.md §"Notification Service ... NotificationProjectionService
// يستهلك outbox" — it was never reachable from any FEATURE_API_PATH, so relocating it here does not
// change services/functions' dispatcher composition (BLK-001).

export interface NotificationRecipient {
  userId: string
  locale: 'ar' | 'en'
  timezone: string
  visibility: 'internal' | 'client'
  active: boolean
  canAccess: boolean
}
export interface NotificationAudiencePort {
  resolve(event: OutboxEvent): Promise<readonly NotificationRecipient[]>
}
export interface NotificationPreferencePort {
  get(organizationId: string, userId: string, eventType: string): Promise<StoredDocument | null>
}
export interface NotificationClock { now(): string }

const base = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const digestId = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 40)
const payloadRecord = (event: OutboxEvent) =>
  event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Readonly<Record<string, unknown>>
    : {}
const resourceIdKeys: Readonly<Record<string, string>> = {
  task: 'taskId', review_request: 'reviewRequestId', approval: 'approvalId',
  comment: 'commentId', attachment: 'fileId', leave_request: 'leaveRequestId', user: 'userId',
}
const idPattern = /^[A-Za-z0-9_-]{2,128}$/
const eventResource = (event: OutboxEvent, resourceType?: string) => {
  if (!resourceType) return null
  const payload = payloadRecord(event)
  // Prefer the event's own resourceType/resourceId when present (e.g. comment.created carries the
  // commenting task/project's id alongside the comment's own id) — that's the thing a notification click
  // can actually navigate to (there is no standalone "comment" page), whereas the policy's static
  // resourceType (e.g. 'comment') only identifies what KIND of event this was.
  const payloadResourceType = payload.resourceType
  const payloadResourceId = payload.resourceId
  if (typeof payloadResourceType === 'string' && typeof payloadResourceId === 'string' && idPattern.test(payloadResourceId)) {
    return { type: payloadResourceType, id: payloadResourceId }
  }
  const value = payload[resourceIdKeys[resourceType] ?? '']
  return typeof value === 'string' && idPattern.test(value)
    ? { type: resourceType, id: value }
    : null
}
const preferenceDefaults = (recipient: NotificationRecipient) => ({
  inApp: true, email: true, digest: 'immediate' as NotificationDigest,
  timezone: recipient.timezone, quietHoursStart: undefined, quietHoursEnd: undefined,
})

export class NotificationProjectionService {
  constructor(
    private readonly store: AtomicStore,
    private readonly audiences: NotificationAudiencePort,
    private readonly preferences: NotificationPreferencePort,
    private readonly clock: NotificationClock,
  ) {}

  async project(event: OutboxEvent) {
    if (!event.organizationId) throw new Error('NOTIFICATION_TENANT_REQUIRED')
    const policy = notificationEventPolicy(event.type)
    if (!policy) return { created: 0, deduplicated: 0, unsupported: true }
    const recipients = await this.audiences.resolve(event)
    if (recipients.length > 100) throw new Error('NOTIFICATION_AUDIENCE_TOO_LARGE')
    if (new Set(recipients.map(({ userId }) => userId)).size !== recipients.length) {
      throw new Error('NOTIFICATION_AUDIENCE_DUPLICATE')
    }
    const resource = eventResource(event, policy.resourceType)
    let created = 0
    let deduplicated = 0
    for (const recipient of recipients) {
      if (!recipient.active || !recipient.canAccess) continue
      const stored = await this.preferences.get(event.organizationId, recipient.userId, event.type)
      const preference = {
        ...preferenceDefaults(recipient),
        ...(stored ? {
          inApp: stored.inApp === true,
          email: stored.email === true,
          digest: stored.digest as NotificationDigest,
          timezone: String(stored.timezone),
          quietHoursStart: typeof stored.quietHoursStart === 'string' ? stored.quietHoursStart : undefined,
          quietHoursEnd: typeof stored.quietHoursEnd === 'string' ? stored.quietHoursEnd : undefined,
        } : {}),
      }
      const inApp = policy.critical || preference.inApp
      const email = policy.externalAllowed && (policy.critical || preference.email)
      const digest = policy.critical ? 'immediate' : preference.digest
      const quietHours = {
        timezone: preference.timezone,
        ...(preference.quietHoursStart ? { start: preference.quietHoursStart } : {}),
        ...(preference.quietHoursEnd ? { end: preference.quietHoursEnd } : {}),
      }
      const availableAt = email
        ? nextNotificationDeliveryAt(this.clock.now(), digest, quietHours)
        : null
      const notificationId = `notification-${digestId(event.id, recipient.userId, event.type)}`
      const deliveryId = `delivery-${digestId(notificationId, 'email')}`
      const outcome = await this.store.runTransaction(async (transaction) => {
        const path = tenantDocumentPath(event.organizationId!, 'notification', notificationId)
        if (await transaction.get(path)) return 'duplicate' as const
        const deliveryState = availableAt ? 'queued' : inApp ? 'in_app_only' : 'suppressed'
        transaction.create(path, {
          ...base(event.organizationId!), recipientUserId: recipient.userId,
          sourceEventId: event.id, eventType: event.type,
          dedupeKey: digestId(event.id, recipient.userId, event.type),
          titleKey: policy.titleKey, previewKey: policy.previewKey,
          status: inApp ? 'unread' : 'archived', deliveryState, inAppVisible: inApp,
          locale: recipient.locale, visibility: recipient.visibility,
          ...(resource ? { resourceType: resource.type, resourceId: resource.id } : {}),
        })
        if (availableAt) {
          transaction.create(tenantDocumentPath(event.organizationId!, 'notification_delivery', deliveryId), {
            ...base(event.organizationId!), notificationId, recipientUserId: recipient.userId,
            channel: 'email', status: 'pending', availableAt, attemptCount: 0,
            digest, locale: recipient.locale, critical: policy.critical,
          })
        }
        return 'created' as const
      })
      if (outcome === 'created') created += 1
      else deduplicated += 1
    }
    return { created, deduplicated, unsupported: false }
  }
}

/** Registers the projector once per notification-eligible event type so worker.ts's handler lookup (by
 * exact eventType) fans every one of them into NotificationProjectionService.project(). */
export function createNotificationProjectionHandlers(service: NotificationProjectionService, eventTypes: readonly string[]): readonly EventHandler[] {
  return eventTypes.map((eventType) => ({ eventType, handle: (event: OutboxEvent) => service.project(event).then(() => undefined) }))
}

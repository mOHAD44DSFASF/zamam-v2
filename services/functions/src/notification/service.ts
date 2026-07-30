import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import {
  nextNotificationDeliveryAt, notificationEventPolicy, SCHEMA_VERSION,
  type NotificationDigest, type OutboxEvent,
} from '@zamam/domain'
import {
  SERVER_TIMESTAMP, tenantDocumentPath,
  type AtomicStore, type PageQuery, type StoredDocument,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const version = z.number().int().positive()
const preferenceSchema = z.object({
  eventType: z.string().min(3).max(100),
  inApp: z.boolean(), email: z.boolean(),
  digest: z.enum(['immediate', 'daily', 'weekly', 'never']),
  timezone: z.string().min(1).max(100),
  quietHoursStart: z.string().optional(), quietHoursEnd: z.string().optional(),
  expectedVersion: version.optional(),
}).strict()

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
export interface NotificationLookupPort {
  get(organizationId: string, notificationId: string): Promise<StoredDocument | null>
}
export interface NotificationAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface NotificationClock { now(): string }
export interface NotificationMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}

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
const eventResource = (event: OutboxEvent, resourceType?: string) => {
  if (!resourceType) return null
  const value = payloadRecord(event)[resourceIdKeys[resourceType] ?? '']
  return typeof value === 'string' && /^[A-Za-z0-9_-]{2,128}$/.test(value)
    ? { type: resourceType, id: value }
    : null
}
const preferenceDefaults = (recipient: NotificationRecipient) => ({
  inApp: true, email: true, digest: 'immediate' as NotificationDigest,
  timezone: recipient.timezone, quietHoursStart: undefined, quietHoursEnd: undefined,
})

export function buildNotificationInboxQuery(input: {
  organizationId: string; recipientUserId: string; status?: 'unread' | 'read';
  limit?: number; cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); id.parse(input.recipientUserId)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'notification',
    filters: [
      { field: 'recipientUserId', operator: '==', value: input.recipientUserId },
      { field: 'inAppVisible', operator: '==', value: true },
      ...(input.status ? [{ field: 'status', operator: '==', value: input.status } as const] : []),
    ],
    orderBy: [{ field: 'createdAt', direction: 'desc' }], limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export function buildDueNotificationDeliveryQuery(input: {
  organizationId: string; now: string; limit?: number; cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); z.string().datetime().parse(input.now)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'notification_delivery',
    filters: [
      { field: 'status', operator: '==', value: 'pending' },
      { field: 'availableAt', operator: '<=', value: input.now },
    ],
    orderBy: [{ field: 'availableAt', direction: 'asc' }], limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

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

export class NotificationCommandService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: NotificationAuthorizationGate,
    private readonly lookup: NotificationLookupPort,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }
  private async context(metadata: NotificationMetadata, permission: 'notification.view' | 'notification.manage_preferences', resourceId: string) {
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId,
      resource: {
        type: 'user', id: metadata.principal.userId, organizationId: metadata.organizationId,
        ownerUserId: metadata.principal.userId, visibility: 'restricted',
      },
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId,
      permission, correlationId: metadata.correlationId,
      idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
      resourceId,
    }
  }
  async setStatus(
    metadata: NotificationMetadata, notificationId: string,
    expectedVersion: number, status: 'read' | 'archived',
  ) {
    id.parse(notificationId); version.parse(expectedVersion)
    const snapshot = await this.lookup.get(metadata.organizationId, notificationId)
    if (!snapshot) throw new Error('ENTITY_NOT_FOUND')
    if (snapshot.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    if (snapshot.recipientUserId !== metadata.principal.userId) throw new Error('NOTIFICATION_OWNER_REQUIRED')
    const context = await this.context(metadata, 'notification.view', notificationId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'notification', notificationId)
      const current = await transaction.get(path)
      if (!current || current.recipientUserId !== metadata.principal.userId) throw new Error('ENTITY_NOT_FOUND')
      if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      transaction.update(path, {
        status, ...(status === 'read' ? { readAt: SERVER_TIMESTAMP } : { archivedAt: SERVER_TIMESTAMP }),
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { notificationId, status, version: expectedVersion + 1 },
        resourceType: 'notification', resourceId: notificationId,
        outbox: { type: `notification.${status}`, version: 1, payload: { notificationId } },
      }
    })
  }
  async updatePreference(metadata: NotificationMetadata, raw: z.input<typeof preferenceSchema>) {
    const input = preferenceSchema.parse(raw)
    const policy = notificationEventPolicy(input.eventType)
    if (!policy) throw new Error('NOTIFICATION_EVENT_UNSUPPORTED')
    if (policy.critical && (!input.inApp || !input.email || input.digest !== 'immediate')) {
      throw new Error('CRITICAL_NOTIFICATION_REQUIRED')
    }
    nextNotificationDeliveryAt(new Date().toISOString(), input.digest, {
      timezone: input.timezone,
      ...(input.quietHoursStart ? { start: input.quietHoursStart } : {}),
      ...(input.quietHoursEnd ? { end: input.quietHoursEnd } : {}),
    })
    const preferenceId = `preference-${digestId(metadata.principal.userId, input.eventType)}`
    const context = await this.context(metadata, 'notification.manage_preferences', preferenceId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'notification_preference', preferenceId)
      const current = await transaction.get(path)
      if (current && current.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT')
      const data = {
        userId: metadata.principal.userId, eventType: input.eventType,
        inApp: input.inApp, email: input.email, digest: input.digest,
        timezone: input.timezone,
        ...(input.quietHoursStart ? { quietHoursStart: input.quietHoursStart } : {}),
        ...(input.quietHoursEnd ? { quietHoursEnd: input.quietHoursEnd } : {}),
      }
      if (current) transaction.update(path, {
        ...data, version: Number(current.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      else transaction.create(path, { ...base(metadata.organizationId), ...data })
      return {
        result: { preferenceId, version: current ? Number(current.version) + 1 : 1 },
        resourceType: 'notification_preference', resourceId: preferenceId,
        outbox: { type: 'notification.preference_updated', version: 1, payload: { preferenceId } },
      }
    })
  }
}

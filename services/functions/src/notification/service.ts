import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { nextNotificationDeliveryAt, notificationEventPolicy, SCHEMA_VERSION } from '@zamam/domain'
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

export interface NotificationLookupPort {
  get(organizationId: string, notificationId: string): Promise<StoredDocument | null>
}
export interface NotificationAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
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

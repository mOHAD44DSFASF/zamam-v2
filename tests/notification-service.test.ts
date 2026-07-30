import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import {
  inQuietHours, nextNotificationDeliveryAt, type OutboxEvent,
} from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  NotificationCommandService,
  buildDueNotificationDeliveryQuery, buildNotificationInboxQuery,
  type NotificationAuthorizationGate, type NotificationMetadata,
} from '../services/functions/src'
import { NotificationProjectionService } from '../services/workers/src/notification-projection'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => { if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: ${path}`); return working.get(path) ?? null },
      create: (path, data) => {
        writeStarted = true
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
        writeStarted = true
        const current = working.get(path)
        if (!current) throw new Error('NOT_FOUND')
        working.set(path, { ...current, ...data })
      },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}
class Gate implements NotificationAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
  }
}
const principal: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (): NotificationMetadata => ({
  organizationId: 'org-1', principal, correlationId: `correlation-${++sequence}`,
  idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const event = (type = 'comment.created'): OutboxEvent => ({
  id: 'event-1', type, version: 1, organizationId: 'org-1',
  actorUserId: 'user-2', correlationId: 'correlation-source',
  idempotencyKey: 'source-key', status: 'pending', attemptCount: 0,
  availableAt: '2026-07-30T19:00:00.000Z', createdAt: '2026-07-30T19:00:00.000Z',
  payload: {
    commentId: 'comment-1', taskId: 'task-1',
    body: 'CONFIDENTIAL_COMMENT_BODY', fileName: 'secret-client-plan.pdf',
    internalNotes: 'DO_NOT_LEAK',
  },
})

describe('notification projection and preferences', () => {
  it('projects one minimized logical notification and deduplicates replay', async () => {
    const store = new MemoryStore()
    const service = new NotificationProjectionService(store, {
      resolve: async () => [{
        userId: 'user-1', locale: 'ar', timezone: 'Africa/Cairo',
        visibility: 'internal', active: true, canAccess: true,
      }],
    }, { get: async () => null }, { now: () => '2026-07-30T19:00:00.000Z' })
    expect(await service.project(event())).toMatchObject({ created: 1, deduplicated: 0 })
    expect(await service.project(event())).toMatchObject({ created: 0, deduplicated: 1 })
    const notification = [...store.records.entries()]
      .find(([path]) => path.includes('/notification/'))?.[1]
    const serialized = JSON.stringify(notification)
    expect(notification).toMatchObject({
      recipientUserId: 'user-1', resourceType: 'comment', resourceId: 'comment-1',
      titleKey: 'notification.comment.mentioned', visibility: 'internal',
    })
    expect(serialized).not.toContain('CONFIDENTIAL_COMMENT_BODY')
    expect(serialized).not.toContain('secret-client-plan.pdf')
    expect(serialized).not.toContain('DO_NOT_LEAK')
  })

  it('skips inactive or unauthorized recipients before writing any record', async () => {
    const store = new MemoryStore()
    const service = new NotificationProjectionService(store, {
      resolve: async () => [
        { userId: 'user-1', locale: 'ar', timezone: 'UTC', visibility: 'internal', active: false, canAccess: true },
        { userId: 'user-2', locale: 'en', timezone: 'UTC', visibility: 'client', active: true, canAccess: false },
      ],
    }, { get: async () => null }, { now: () => '2026-07-30T19:00:00.000Z' })
    expect(await service.project(event())).toMatchObject({ created: 0 })
    expect(store.records.size).toBe(0)
  })

  it('forces critical approval notifications even when a stored preference is muted', async () => {
    const store = new MemoryStore()
    const service = new NotificationProjectionService(store, {
      resolve: async () => [{
        userId: 'user-1', locale: 'en', timezone: 'UTC',
        visibility: 'internal', active: true, canAccess: true,
      }],
    }, {
      get: async () => ({
        inApp: false, email: false, digest: 'never', timezone: 'UTC',
      }),
    }, { now: () => '2026-07-30T19:00:00.000Z' })
    const approval = { ...event('approval.requested'), payload: { approvalId: 'approval-1' } }
    await service.project(approval)
    const notification = [...store.records.entries()]
      .find(([path]) => path.includes('/notification/'))?.[1]
    const delivery = [...store.records.entries()]
      .find(([path]) => path.includes('/notification_delivery/'))?.[1]
    expect(notification).toMatchObject({ inAppVisible: true, deliveryState: 'queued' })
    expect(delivery).toMatchObject({ digest: 'immediate', critical: true })
  })

  it('rejects attempts to mute critical event preferences', async () => {
    const store = new MemoryStore()
    const service = new NotificationCommandService(store, new Gate(), {
      get: async () => null,
    })
    await expect(service.updatePreference(metadata(), {
      eventType: 'approval.requested', inApp: false, email: false,
      digest: 'never', timezone: 'UTC',
    })).rejects.toThrow('CRITICAL_NOTIFICATION_REQUIRED')
  })
})

describe('notification scheduling and bounded queries', () => {
  it('handles Cairo overnight quiet hours and schedules after the window', () => {
    const quiet = { timezone: 'Africa/Cairo', start: '22:00', end: '07:00' }
    expect(inQuietHours('2026-07-30T20:30:00.000Z', quiet)).toBe(true)
    const next = nextNotificationDeliveryAt('2026-07-30T20:30:00.000Z', 'immediate', quiet)
    expect(next).toBe('2026-07-31T04:00:00.000Z')
  })

  it('uses future daily and weekly digest slots', () => {
    const input = { timezone: 'Africa/Cairo' }
    const now = '2026-07-30T10:00:00.000Z'
    expect(Date.parse(nextNotificationDeliveryAt(now, 'daily', input)!)).toBeGreaterThan(Date.parse(now))
    expect(Date.parse(nextNotificationDeliveryAt(now, 'weekly', input)!)).toBeGreaterThan(Date.parse(now))
  })

  it('enforces bounded inbox and delivery scans', () => {
    expect(buildNotificationInboxQuery({
      organizationId: 'org-1', recipientUserId: 'user-1',
    })).toMatchObject({ entityKind: 'notification', limit: 50 })
    expect(buildDueNotificationDeliveryQuery({
      organizationId: 'org-1', now: '2026-07-30T10:00:00.000Z',
    })).toMatchObject({ entityKind: 'notification_delivery', limit: 50 })
    expect(() => buildNotificationInboxQuery({
      organizationId: 'org-1', recipientUserId: 'user-1', limit: 51,
    })).toThrow('UNBOUNDED_QUERY_DENIED')
  })
})

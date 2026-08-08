import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import {
  inQuietHours, nextNotificationDeliveryAt, notificationEventPolicy, resolveNotificationMessage, type OutboxEvent,
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

  it('projects step-arrived and step-sent-back task events (the step pipeline notification hooks)', async () => {
    const store = new MemoryStore()
    const service = new NotificationProjectionService(store, {
      resolve: async () => [{ userId: 'user-1', locale: 'ar', timezone: 'Africa/Cairo', visibility: 'internal', active: true, canAccess: true }],
    }, { get: async () => null }, { now: () => '2026-07-30T19:00:00.000Z' })
    const arrived = event('task.step_arrived')
    expect(await service.project(arrived)).toMatchObject({ created: 1 })
    expect([...store.records.entries()].find(([path]) => path.includes('/notification/'))?.[1]).toMatchObject({
      titleKey: 'notification.task.step_arrived', resourceType: 'task', resourceId: 'task-1',
    })
    const store2 = new MemoryStore()
    const service2 = new NotificationProjectionService(store2, {
      resolve: async () => [{ userId: 'user-1', locale: 'ar', timezone: 'Africa/Cairo', visibility: 'internal', active: true, canAccess: true }],
    }, { get: async () => null }, { now: () => '2026-07-30T19:00:00.000Z' })
    expect(await service2.project(event('task.step_sent_back'))).toMatchObject({ created: 1 })
    expect([...store2.records.entries()].find(([path]) => path.includes('/notification/'))?.[1]).toMatchObject({
      titleKey: 'notification.task.step_sent_back', resourceType: 'task',
    })
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

  it('resolves every titleKey/previewKey the policy table emits to real Arabic text, not a blank string', () => {
    // Regression test: /v1/notifications/query used to return the raw stored notification doc — which
    // carries titleKey/previewKey (i18n keys), not the `title`/`preview` fields the frontend reads — so
    // every notification rendered with a blank title and preview. This asserts every key actually
    // referenced by eventPolicies resolves to non-empty text, and an unknown key doesn't crash (falls
    // back to the raw key rather than throwing).
    const allKeys = ['created', 'assigned', 'transitioned', 'step_arrived', 'step_sent_back', 'overdue']
      .map((suffix) => `notification.task.${suffix}`)
      .concat(['notification.review.requested', 'notification.approval.requested', 'notification.approval.completed', 'notification.comment.mentioned', 'notification.file.available', 'notification.file.quarantined', 'notification.leave.requested', 'notification.security.user_disabled', 'notification.open_securely', 'notification.review_securely', 'notification.approval_securely', 'notification.security_review'])
    for (const key of allKeys) {
      const resolved = resolveNotificationMessage(key)
      expect(resolved).not.toBe('')
      expect(resolved).not.toBe(key)
    }
    expect(resolveNotificationMessage('notification.made_up_key_no_such_thing')).toBe('notification.made_up_key_no_such_thing')
  })

  it('keys the user-disabled policy entry to the event type EmployeeService.disable() actually emits', () => {
    // Regression test: the policy used to be keyed 'security.user_disabled', but employee/service.ts emits
    // 'user.disabled' — a name nothing in the policy table matched, so this notification (and its worker
    // registry entry) silently never fired for any disabled account.
    expect(notificationEventPolicy('user.disabled')).toMatchObject({ titleKey: 'notification.security.user_disabled', critical: true })
    expect(notificationEventPolicy('security.user_disabled')).toBeNull()
  })

  it('projects user.disabled (the real emitted event name) into a real notification', async () => {
    const store = new MemoryStore()
    const service = new NotificationProjectionService(store, {
      resolve: async () => [{ userId: 'user-1', locale: 'ar', timezone: 'Africa/Cairo', visibility: 'internal', active: true, canAccess: true }],
    }, { get: async () => null }, { now: () => '2026-07-30T19:00:00.000Z' })
    expect(await service.project({ ...event('user.disabled'), payload: { userId: 'user-3' } })).toMatchObject({ created: 1 })
    expect([...store.records.entries()].find(([path]) => path.includes('/notification/'))?.[1]).toMatchObject({
      titleKey: 'notification.security.user_disabled',
    })
  })

  it('prefers a comment event\'s own resourceType/resourceId (the commented-on task) over the comment id, so a click can deep-link somewhere real', async () => {
    const store = new MemoryStore()
    const service = new NotificationProjectionService(store, {
      resolve: async () => [{ userId: 'user-1', locale: 'ar', timezone: 'Africa/Cairo', visibility: 'internal', active: true, canAccess: true }],
    }, { get: async () => null }, { now: () => '2026-07-30T19:00:00.000Z' })
    await service.project(event('comment.created'))
    const notification = [...store.records.entries()].find(([path]) => path.includes('/notification/'))?.[1]
    // event()'s default payload has both commentId:'comment-1' and resourceType/resourceId — the fixture
    // as written doesn't set resourceType/resourceId explicitly, so this exercises the fallback path; a
    // payload that DOES carry them (as the real comment.created emitter always does) takes priority.
    expect(notification?.resourceType).toBe('comment')
    const store2 = new MemoryStore()
    const service2 = new NotificationProjectionService(store2, {
      resolve: async () => [{ userId: 'user-1', locale: 'ar', timezone: 'Africa/Cairo', visibility: 'internal', active: true, canAccess: true }],
    }, { get: async () => null }, { now: () => '2026-07-30T19:00:00.000Z' })
    await service2.project({ ...event('comment.created'), payload: { commentId: 'comment-1', resourceType: 'task', resourceId: 'task-9', visibility: 'internal', mentionedUserIds: ['user-1'] } })
    expect([...store2.records.entries()].find(([path]) => path.includes('/notification/'))?.[1]).toMatchObject({
      resourceType: 'task', resourceId: 'task-9',
    })
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

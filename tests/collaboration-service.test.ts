import { describe, expect, it } from 'vitest'
import type {
  AuthorizationPrincipal, AuthorizationRequest, ResourceAuthorizationContext,
} from '@zamam/authorization'
import { normalizeCommentBody } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  CollaborationService,
  buildCommentQuery,
  buildMentionInboxQuery,
  buildResourceActivityQuery,
  type CollaborationAuthorizationGate,
  type CollaborationCommentPort,
  type CollaborationMetadata,
  type CollaborationResourcePort,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    // Enforces Firestore's "all reads before all writes" rule so an interleaved get-after-write in a
    // service transaction is caught here instead of only against the real emulator.
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => {
        if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: read of "${path}" after a write`)
        return working.get(path) ?? null
      },
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
class Gate implements CollaborationAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
  }
}
const member: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
const clientPrincipal: AuthorizationPrincipal = {
  ...member, userId: 'client-user-1', principalType: 'client', employmentStatus: 'not_applicable',
  clientAccountIds: ['client-1'],
}
let sequence = 0
const metadata = (principal = member): CollaborationMetadata => ({
  organizationId: 'org-1', principal,
  correlationId: `correlation-${++sequence}`,
  idempotencyKey: `idempotency-${sequence}`,
  fingerprint: `fingerprint-${sequence}`,
})
function fixture(now = '2026-07-30T10:00:00.000Z') {
  const store = new MemoryStore()
  store.records.set('v2Organizations/org-1/task/task-1', {
    organizationId: 'org-1', version: 1, clientVisible: true,
  })
  store.records.set('v2Organizations/org-1/project/project-1', {
    organizationId: 'org-1', version: 1, clientVisible: false,
  })
  store.records.set('v2Organizations/org-1/review_request/review-1', {
    organizationId: 'org-1', version: 1, taskId: 'task-1',
  })
  const resources: CollaborationResourcePort = {
    resolve: async (organizationId, type, resourceId) => {
      if (organizationId !== 'org-1') return null
      const isTask = type === 'task' && resourceId === 'task-1'
      const isProject = type === 'project' && resourceId === 'project-1'
      if (!isTask && !isProject) return null
      const base: ResourceAuthorizationContext = {
        type, id: resourceId, organizationId, projectId: 'project-1',
        visibility: isTask ? 'client' : 'internal',
      }
      return isTask ? { ...base, clientAccountId: 'client-1' } : base
    },
    validateMentionTargets: async ({ visibility, userIds }) => ({
      valid: visibility === 'internal' || userIds.every((value) => value.startsWith('client-')),
      invalidUserIds: visibility === 'client' ? userIds.filter((value) => !value.startsWith('client-')) : [],
    }),
  }
  const comments: CollaborationCommentPort = {
    get: async (organizationId, commentId) =>
      store.records.get(`v2Organizations/${organizationId}/comment/${commentId}`) ?? null,
  }
  const gate = new Gate()
  return {
    store, gate, resources,
    service: new CollaborationService(store, gate, resources, comments, { now: () => now }),
  }
}

describe('collaboration boundaries', () => {
  it('normalizes plain text and rejects control characters', () => {
    expect(normalizeCommentBody('  مرحباً\r\nبالفريق  ')).toBe('مرحباً\nبالفريق')
    expect(() => normalizeCommentBody(`unsafe${String.fromCharCode(0)}text`)).toThrow('COMMENT_CONTROL_CHARACTER_DENIED')
  })

  it('creates an internal comment, explicit mentions, and an automatic watcher atomically', async () => {
    const { service, store, gate } = fixture()
    const result = await service.create(metadata(), {
      id: 'comment-1', resourceType: 'task', resourceId: 'task-1',
      body: 'تحديث داخلي', visibility: 'internal', mentionedUserIds: ['user-2'],
    })
    expect(result.result).toMatchObject({ commentId: 'comment-1', mentionCount: 1 })
    expect(store.records.get('v2Organizations/org-1/comment/comment-1')).toMatchObject({
      authorUserId: 'user-1', visibility: 'internal', status: 'active',
    })
    expect([...store.records.keys()].filter((path) => path.includes('/mention/'))).toHaveLength(1)
    expect([...store.records.keys()].filter((path) => path.includes('/task_watcher/'))).toHaveLength(1)
    expect(gate.requests.map(({ permission }) => permission)).toEqual([
      'comment.internal.create', 'mention.create',
    ])
  })

  it('denies a client attempting to enter the internal channel', async () => {
    const { service, store } = fixture()
    await expect(service.create(metadata(clientPrincipal), {
      id: 'comment-2', resourceType: 'task', resourceId: 'task-1',
      body: 'محاولة داخلية', visibility: 'internal',
    })).rejects.toThrow('CLIENT_INTERNAL_CHANNEL_DENIED')
    expect([...store.records.keys()].some((path) => path.includes('/comment/'))).toBe(false)
  })

  it('denies a client-visible comment on an internal-only resource', async () => {
    const { service } = fixture()
    await expect(service.create(metadata(), {
      id: 'comment-3', resourceType: 'project', resourceId: 'project-1',
      body: 'قناة عميل', visibility: 'client',
    })).rejects.toThrow('CLIENT_COMMENT_RESOURCE_NOT_VISIBLE')
  })

  it('validates mention visibility before writing', async () => {
    const { service, store } = fixture()
    await expect(service.create(metadata(), {
      id: 'comment-4', resourceType: 'task', resourceId: 'task-1',
      body: 'تعليق عميل', visibility: 'client', mentionedUserIds: ['internal-user'],
    })).rejects.toThrow('MENTION_TARGET_NOT_VISIBLE')
    expect([...store.records.keys()].some((path) => path.includes('/comment/'))).toBe(false)
  })

  it('locks review-linked comments and never edits their evidence', async () => {
    const { service } = fixture()
    await service.create(metadata(), {
      id: 'comment-5', resourceType: 'task', resourceId: 'task-1',
      body: 'سبب القرار', visibility: 'internal', linkedReviewRequestId: 'review-1',
    })
    await expect(service.update(metadata(), 'comment-5', 1, 'سبب مختلف'))
      .rejects.toThrow('COMMENT_EVIDENCE_LOCKED')
  })

  it('expires the author edit window and tombstones instead of deleting', async () => {
    const initial = fixture('2026-07-30T10:00:00.000Z')
    await initial.service.create(metadata(), {
      id: 'comment-6', resourceType: 'task', resourceId: 'task-1',
      body: 'نسخة أولى', visibility: 'internal',
    })
    const comments: CollaborationCommentPort = {
      get: async (organizationId, commentId) =>
        initial.store.records.get(`v2Organizations/${organizationId}/comment/${commentId}`) ?? null,
    }
    const expired = new CollaborationService(initial.store, initial.gate, initial.resources, comments, {
      now: () => '2026-07-30T10:16:00.000Z',
    })
    await expect(expired.update(metadata(), 'comment-6', 1, 'متأخر')).rejects.toThrow('COMMENT_EDIT_WINDOW_EXPIRED')
    await initial.service.tombstone(metadata(), 'comment-6', 1)
    expect(initial.store.records.get('v2Organizations/org-1/comment/comment-6')).toMatchObject({
      body: '[deleted]', status: 'deleted', version: 2,
    })
  })

  it('uses one deterministic reaction and reversible watcher records', async () => {
    const { service, store } = fixture()
    await service.create(metadata(), {
      id: 'comment-7', resourceType: 'task', resourceId: 'task-1',
      body: 'خبر جيد', visibility: 'client',
    })
    const first = await service.setReaction(metadata(clientPrincipal), 'comment-7', 'celebrate', true)
    await service.setReaction(metadata(clientPrincipal), 'comment-7', 'celebrate', false)
    expect([...store.records.keys()].filter((path) => path.includes('/reaction/'))).toHaveLength(1)
    expect(store.records.get(`v2Organizations/org-1/reaction/${first.result.reactionId}`)).toMatchObject({ status: 'removed' })
    await service.setTaskWatch(metadata(clientPrincipal), 'task-1', true)
    await service.setTaskWatch(metadata(clientPrincipal), 'task-1', false)
    expect([...store.records.values()].some((record) => record.userId === 'client-user-1' && record.status === 'ended')).toBe(true)
  })
})

describe('collaboration query projections', () => {
  it('forces client comments to the client-only projection', () => {
    const query = buildCommentQuery({
      organizationId: 'org-1', resourceType: 'task', resourceId: 'task-1', principalType: 'client',
    })
    expect(query.filters).toContainEqual({ field: 'visibility', operator: '==', value: 'client' })
  })
  it('bounds mention inbox and denies raw audit activity to clients', () => {
    expect(buildMentionInboxQuery({ organizationId: 'org-1', userId: 'user-1' }).limit).toBe(50)
    expect(() => buildResourceActivityQuery({
      organizationId: 'org-1', resourceType: 'task', resourceId: 'task-1', principalType: 'client',
    })).toThrow('CLIENT_ACTIVITY_PROJECTION_REQUIRED')
  })
})

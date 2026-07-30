import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  ReviewService, buildReviewInboxQuery,
  type ReviewAuthorizationGate, type ReviewEligibilityPort, type ReviewMetadata,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => { if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: ${path}`); return working.get(path) ?? null },
      create: (path, data) => { writeStarted = true; if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, { ...data }) },
      update: (path, data) => { writeStarted = true; const current = working.get(path); if (!current) throw new Error('NOT_FOUND'); working.set(path, { ...current, ...data }) },
    }
    const result = await operation(transaction); this.records = working; return result
  }
}
class Gate implements ReviewAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) }
}
const principal = (userId = 'requester-1', type: 'member' | 'client' = 'member'): AuthorizationPrincipal => ({
  userId, authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: type === 'client' ? 'not_applicable' : 'active',
  organizationId: 'org-1', membershipStatus: 'active', principalType: type,
  clientAccountIds: type === 'client' ? ['client-1'] : [], stepUpSatisfied: true, mfaSatisfied: true,
})
let sequence = 0
const metadata = (userId = 'requester-1', type: 'member' | 'client' = 'member'): ReviewMetadata => ({
  organizationId: 'org-1', principal: principal(userId, type),
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const eligibility: ReviewEligibilityPort = { validateReviewers: async () => ({ valid: true, errors: [] }) }
const now = '2026-08-01T10:00:00.000Z'
function fixture(policy: 'single' | 'any' | 'all' | 'ordered' = 'all', visibility: 'internal' | 'client' = 'internal') {
  const store = new MemoryStore()
  store.records.set('v2Organizations/org-1/task/task-1', {
    organizationId: 'org-1', version: 5, status: 'in_review', createdBy: 'creator-1', clientVisible: true,
  })
  const gate = new Gate()
  const service = new ReviewService(store, gate, eligibility, { now: () => now })
  const reviewers = policy === 'single' ? ['reviewer-1'] : ['reviewer-1', 'reviewer-2']
  return { store, gate, service, reviewers, visibility }
}
async function requested(candidate = fixture()) {
  const response = await candidate.service.request(metadata(), {
    id: 'review-1', taskId: 'task-1', reviewerUserIds: candidate.reviewers,
    policy: candidate.reviewers.length === 1 ? 'single' : 'all',
    reviewedVersion: 5, visibility: candidate.visibility, dueAt: '2026-08-01T09:00:00.000Z',
  })
  return { ...candidate, approvalIds: response.result.approvalIds }
}

describe('reviews and approvals', () => {
  it('creates immutable per-reviewer approval evidence for the reviewed task version', async () => {
    const result = await requested()
    expect(result.approvalIds).toHaveLength(2)
    expect(result.store.records.get(`v2Organizations/org-1/approval/${result.approvalIds[0]}`)).toMatchObject({
      reviewRequestId: 'review-1', reviewedVersion: 5, round: 1, status: 'pending',
    })
  })

  it('requires all reviewers for all policy and rejects duplicate decisions', async () => {
    const result = await requested()
    const first = result.approvalIds[0]!
    const second = result.approvalIds[1]!
    await result.service.decide(metadata('reviewer-1'), { approvalId: first, expectedApprovalVersion: 1, decision: 'approved' })
    expect(result.store.records.get('v2Organizations/org-1/review_request/review-1')).toMatchObject({ status: 'in_review' })
    await result.service.decide(metadata('reviewer-2'), { approvalId: second, expectedApprovalVersion: 1, decision: 'approved' })
    expect(result.store.records.get('v2Organizations/org-1/review_request/review-1')).toMatchObject({ status: 'approved' })
    await expect(result.service.decide(metadata('reviewer-2'), { approvalId: second, expectedApprovalVersion: 2, decision: 'rejected', reason: 'رفض مكرر' }))
      .rejects.toThrow('APPROVAL_DECISION_IMMUTABLE')
  })

  it('finishes any-one policy and cancels remaining pending evidence', async () => {
    const candidate = fixture('any')
    const response = await candidate.service.request(metadata(), {
      id: 'review-any', taskId: 'task-1', reviewerUserIds: candidate.reviewers,
      policy: 'any', reviewedVersion: 5, visibility: 'internal',
    })
    await candidate.service.decide(metadata('reviewer-1'), {
      approvalId: response.result.approvalIds[0]!, expectedApprovalVersion: 1, decision: 'approved',
    })
    expect(candidate.store.records.get('v2Organizations/org-1/review_request/review-any')).toMatchObject({ status: 'approved' })
    expect(candidate.store.records.get(`v2Organizations/org-1/approval/${response.result.approvalIds[1]}`)).toMatchObject({ status: 'cancelled' })
  })

  it('enforces ordered approval sequence', async () => {
    const candidate = fixture('ordered')
    const response = await candidate.service.request(metadata(), {
      id: 'review-ordered', taskId: 'task-1', reviewerUserIds: candidate.reviewers,
      policy: 'ordered', reviewedVersion: 5, visibility: 'internal',
    })
    await expect(candidate.service.decide(metadata('reviewer-2'), {
      approvalId: response.result.approvalIds[1]!, expectedApprovalVersion: 1, decision: 'approved',
    })).rejects.toThrow('ORDERED_APPROVAL_NOT_READY')
  })

  it('rejects a decision when the task changed after review request', async () => {
    const result = await requested()
    result.store.records.set('v2Organizations/org-1/task/task-1', {
      ...result.store.records.get('v2Organizations/org-1/task/task-1'), version: 6,
    })
    await expect(result.service.decide(metadata('reviewer-1'), {
      approvalId: result.approvalIds[0]!, expectedApprovalVersion: 1, decision: 'approved',
    })).rejects.toThrow('REVIEWED_VERSION_STALE')
  })

  it('creates a change request and resubmits as a new review round', async () => {
    const result = await requested()
    await result.service.decide(metadata('reviewer-1'), {
      approvalId: result.approvalIds[0]!, expectedApprovalVersion: 1,
      decision: 'changes_requested', reason: 'يرجى تعديل العنوان',
    })
    result.store.records.set('v2Organizations/org-1/task/task-1', {
      ...result.store.records.get('v2Organizations/org-1/task/task-1'), version: 6,
    })
    const resubmitted = await result.service.resubmit(metadata(), {
      reviewRequestId: 'review-1', expectedRequestVersion: 2, reviewedVersion: 6,
    })
    expect(resubmitted.result).toMatchObject({ round: 2 })
    expect(result.store.records.get('v2Organizations/org-1/review_request/review-1')).toMatchObject({ status: 'requested', round: 2, reviewedVersion: 6 })
    expect(result.store.records.get('v2Organizations/org-1/change_request/change-033e892221979048f223422577395522')).not.toMatchObject({ status: 'open' })
  })

  it('delegates without rewriting the original approval decision', async () => {
    const result = await requested()
    const delegated = await result.service.delegate(metadata('reviewer-1'), {
      approvalId: result.approvalIds[0]!, delegateUserId: 'reviewer-3',
      expectedApprovalVersion: 1, reason: 'إجازة المراجع الحالي',
    })
    expect(result.store.records.get(`v2Organizations/org-1/approval/${result.approvalIds[0]}`)).toMatchObject({ status: 'delegated', delegatedToUserId: 'reviewer-3' })
    expect(result.store.records.get(`v2Organizations/org-1/approval/${delegated.result.delegatedApprovalId}`)).toMatchObject({ status: 'pending', delegatedFromApprovalId: result.approvalIds[0] })
  })

  it('expires due reviews and pending approvals once', async () => {
    const result = await requested()
    await result.service.expire(metadata(), 'review-1', 1)
    expect(result.store.records.get('v2Organizations/org-1/review_request/review-1')).toMatchObject({ status: 'expired' })
    expect(result.store.records.get(`v2Organizations/org-1/approval/${result.approvalIds[0]}`)).toMatchObject({ status: 'expired' })
  })

  it('uses client approval permission and a bounded inbox query', async () => {
    const candidate = fixture('single', 'client')
    const response = await candidate.service.request(metadata(), {
      id: 'review-client', taskId: 'task-1', reviewerUserIds: ['client-user'],
      policy: 'single', reviewedVersion: 5, visibility: 'client',
    })
    await candidate.service.decide(metadata('client-user', 'client'), {
      approvalId: response.result.approvalIds[0]!, expectedApprovalVersion: 1, decision: 'approved',
    })
    expect(candidate.gate.requests.at(-1)).toMatchObject({ permission: 'task.approve' })
    expect(buildReviewInboxQuery({ organizationId: 'org-1', reviewerUserId: 'client-user' })).toMatchObject({ entityKind: 'approval', limit: 50 })
  })
})


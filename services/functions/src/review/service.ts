import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest, Permission } from '@zamam/authorization'
import { SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type AtomicTransaction, type PageQuery } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const version = z.number().int().positive()
const requestSchema = z.object({
  id, taskId: id, stageExecutionId: id.optional(),
  reviewerUserIds: z.array(id).min(1).max(20),
  policy: z.enum(['single', 'any', 'all', 'ordered']),
  reviewedVersion: version,
  visibility: z.enum(['internal', 'client']).default('internal'),
  dueAt: z.string().datetime().optional(),
}).strict()

export interface ReviewAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface ReviewEligibilityPort {
  validateReviewers(input: {
    organizationId: string
    taskId: string
    reviewerUserIds: readonly string[]
    visibility: 'internal' | 'client'
  }): Promise<{ valid: boolean; errors: readonly string[] }>
}
export interface ReviewMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface ReviewClock { now(): string }

const base = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const owned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}
const approvalId = (requestId: string, round: number, reviewerUserId: string) =>
  `approval-${createHash('sha256').update(`${requestId}:${round}:${reviewerUserId}`).digest('hex').slice(0, 32)}`
const changeId = (requestId: string, round: number) => `change-${createHash('sha256').update(`${requestId}:${round}`).digest('hex').slice(0, 32)}`

export function buildReviewInboxQuery(input: {
  organizationId: string
  reviewerUserId: string
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); id.parse(input.reviewerUserId)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'approval',
    filters: [
      { field: 'reviewerUserId', operator: '==', value: input.reviewerUserId },
      { field: 'status', operator: '==', value: 'pending' },
    ],
    orderBy: [{ field: 'createdAt', direction: 'asc' }], limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class ReviewService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: ReviewAuthorizationGate,
    private readonly eligibility: ReviewEligibilityPort,
    private readonly clock: ReviewClock,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  private async context(metadata: ReviewMetadata, permission: Permission, taskId?: string, visibility: 'internal' | 'client' = 'internal') {
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId,
      ...(taskId ? { resource: {
        type: 'task', id: taskId, organizationId: metadata.organizationId,
        visibility, ...(visibility === 'client' && metadata.principal.clientAccountIds[0] ? { clientAccountId: metadata.principal.clientAccountIds[0] } : {}),
      } } : {}),
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async request(metadata: ReviewMetadata, raw: z.input<typeof requestSchema>) {
    const parsed = requestSchema.parse(raw)
    const reviewers = [...new Set(parsed.reviewerUserIds)]
    if (reviewers.length !== parsed.reviewerUserIds.length) throw new Error('DUPLICATE_REVIEWER')
    if (parsed.policy === 'single' && reviewers.length !== 1) throw new Error('SINGLE_REVIEWER_REQUIRED')
    const eligibility = await this.eligibility.validateReviewers({
      organizationId: metadata.organizationId, taskId: parsed.taskId,
      reviewerUserIds: reviewers, visibility: parsed.visibility,
    })
    if (!eligibility.valid) throw new Error(eligibility.errors[0] ?? 'REVIEWER_NOT_ELIGIBLE')
    const context = await this.context(metadata, 'review.request', parsed.taskId, parsed.visibility)
    return this.audit.execute(context, async (transaction) => {
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', parsed.taskId), metadata.organizationId)
      if (task.version !== parsed.reviewedVersion) throw new Error('REVIEWED_VERSION_STALE')
      if (typeof task.createdBy === 'string' && reviewers.includes(task.createdBy)) throw new Error('SELF_REVIEW_DENIED')
      const path = tenantDocumentPath(metadata.organizationId, 'review_request', parsed.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      const approvalIds = reviewers.map((reviewer) => approvalId(parsed.id, 1, reviewer))
      transaction.create(path, {
        ...base(metadata.organizationId), taskId: parsed.taskId,
        ...(parsed.stageExecutionId ? { stageExecutionId: parsed.stageExecutionId } : {}),
        requestedBy: metadata.principal.userId, reviewerUserIds: reviewers, approvalIds,
        policy: parsed.policy, round: 1, reviewedVersion: parsed.reviewedVersion,
        visibility: parsed.visibility, status: 'requested', ...(parsed.dueAt ? { dueAt: parsed.dueAt } : {}),
      })
      approvalIds.forEach((approvalRecordId, order) => transaction.create(
        tenantDocumentPath(metadata.organizationId, 'approval', approvalRecordId),
        { ...base(metadata.organizationId), reviewRequestId: parsed.id, round: 1, reviewerUserId: reviewers[order], order, reviewedVersion: parsed.reviewedVersion, status: 'pending' },
      ))
      return {
        result: { reviewRequestId: parsed.id, approvalIds, round: 1 },
        resourceType: 'review_request', resourceId: parsed.id,
        outbox: { type: 'review.requested', version: 1, payload: { reviewRequestId: parsed.id, taskId: parsed.taskId, reviewerUserIds: reviewers } },
      }
    })
  }

  async decide(metadata: ReviewMetadata, input: {
    approvalId: string
    expectedApprovalVersion: number
    decision: 'approved' | 'rejected' | 'changes_requested'
    reason?: string
  }) {
    id.parse(input.approvalId); version.parse(input.expectedApprovalVersion)
    const snapshot = await this.store.runTransaction(async (transaction) => {
      const approval = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'approval', input.approvalId), metadata.organizationId)
      const request = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'review_request', String(approval.reviewRequestId)), metadata.organizationId)
      return { approval, request }
    })
    const permission: Permission = snapshot.request.visibility === 'client' ? 'task.approve' : 'review.perform'
    const context = await this.context(metadata, permission, String(snapshot.request.taskId), snapshot.request.visibility as 'internal' | 'client')
    const reason = input.reason?.trim()
    if (input.decision !== 'approved' && (!reason || reason.length < 5)) throw new Error('REVIEW_DECISION_REASON_REQUIRED')
    return this.audit.execute(context, async (transaction) => {
      const approvalPath = tenantDocumentPath(metadata.organizationId, 'approval', input.approvalId)
      const approval = await owned(transaction, approvalPath, metadata.organizationId)
      if (approval.version !== input.expectedApprovalVersion || approval.status !== 'pending') throw new Error('APPROVAL_DECISION_IMMUTABLE')
      if (approval.reviewerUserId !== metadata.principal.userId) throw new Error('REVIEWER_IDENTITY_MISMATCH')
      const requestPath = tenantDocumentPath(metadata.organizationId, 'review_request', String(approval.reviewRequestId))
      const request = await owned(transaction, requestPath, metadata.organizationId)
      if (!['requested', 'in_review'].includes(String(request.status)) || approval.round !== request.round) throw new Error('REVIEW_REQUEST_NOT_ACTIVE')
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', String(request.taskId)), metadata.organizationId)
      if (task.version !== request.reviewedVersion) throw new Error('REVIEWED_VERSION_STALE')
      const approvals = await Promise.all((request.approvalIds as string[]).map((recordId) =>
        owned(transaction, tenantDocumentPath(metadata.organizationId, 'approval', recordId), metadata.organizationId)))
      if (request.policy === 'ordered') {
        const earlier = approvals.filter((item) => Number(item.order) < Number(approval.order))
        if (earlier.some((item) => item.status !== 'approved')) throw new Error('ORDERED_APPROVAL_NOT_READY')
      }
      transaction.update(approvalPath, {
        status: input.decision, decidedAt: this.clock.now(), decidedBy: metadata.principal.userId,
        ...(reason ? { decisionReason: reason } : {}),
        version: input.expectedApprovalVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      const effective = approvals.map((item) => item === approval ? { ...item, status: input.decision } : item)
      let requestStatus: 'in_review' | 'approved' | 'rejected' | 'changes_requested' = 'in_review'
      if (input.decision === 'rejected') requestStatus = 'rejected'
      else if (input.decision === 'changes_requested') requestStatus = 'changes_requested'
      else if (request.policy === 'single' || request.policy === 'any' || effective.every((item) => item.status === 'approved')) requestStatus = 'approved'
      if (requestStatus !== 'in_review') {
        for (const [index, item] of effective.entries()) {
          if (item.status === 'pending') transaction.update(
            tenantDocumentPath(metadata.organizationId, 'approval', String((request.approvalIds as string[])[index])),
            { status: 'cancelled', updatedAt: SERVER_TIMESTAMP, version: Number(item.version) + 1 },
          )
        }
      }
      transaction.update(requestPath, {
        status: requestStatus, version: Number(request.version) + 1, updatedAt: SERVER_TIMESTAMP,
        ...(requestStatus !== 'in_review' ? { completedAt: this.clock.now() } : {}),
      })
      if (requestStatus === 'changes_requested') transaction.create(
        tenantDocumentPath(metadata.organizationId, 'change_request', changeId(String(request.id ?? approval.reviewRequestId), Number(request.round))),
        { ...base(metadata.organizationId), taskId: request.taskId, reviewRequestId: approval.reviewRequestId, reviewRound: request.round, requestedBy: metadata.principal.userId, description: reason!, status: 'open' },
      )
      return {
        result: { approvalId: input.approvalId, decision: input.decision, reviewStatus: requestStatus },
        resourceType: 'approval', resourceId: input.approvalId,
        outbox: { type: 'review.completed', version: 1, payload: { reviewRequestId: approval.reviewRequestId, approvalId: input.approvalId, decision: input.decision, reviewStatus: requestStatus } },
      }
    })
  }

  async resubmit(metadata: ReviewMetadata, input: {
    reviewRequestId: string
    expectedRequestVersion: number
    reviewedVersion: number
  }) {
    id.parse(input.reviewRequestId); version.parse(input.expectedRequestVersion); version.parse(input.reviewedVersion)
    const snapshot = await this.store.runTransaction(async (transaction) =>
      owned(transaction, tenantDocumentPath(metadata.organizationId, 'review_request', input.reviewRequestId), metadata.organizationId))
    const reviewerUserIds = snapshot.reviewerUserIds as string[]
    const visibility = snapshot.visibility as 'internal' | 'client'
    const eligibility = await this.eligibility.validateReviewers({
      organizationId: metadata.organizationId, taskId: String(snapshot.taskId), reviewerUserIds, visibility,
    })
    if (!eligibility.valid) throw new Error(eligibility.errors[0] ?? 'REVIEWER_NOT_ELIGIBLE')
    const context = await this.context(metadata, 'review.request', String(snapshot.taskId), visibility)
    return this.audit.execute(context, async (transaction) => {
      const requestPath = tenantDocumentPath(metadata.organizationId, 'review_request', input.reviewRequestId)
      const request = await owned(transaction, requestPath, metadata.organizationId)
      if (request.version !== input.expectedRequestVersion || request.status !== 'changes_requested') throw new Error('REVIEW_RESUBMIT_STATE_INVALID')
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', String(request.taskId)), metadata.organizationId)
      if (task.version !== input.reviewedVersion || input.reviewedVersion <= Number(request.reviewedVersion)) throw new Error('REVIEWED_VERSION_STALE')
      const round = Number(request.round) + 1
      const approvalIds = reviewerUserIds.map((reviewer) => approvalId(input.reviewRequestId, round, reviewer))
      // Read phase — the prior change_request is read before any write (Firestore transaction rule; the
      // approval creates previously preceded this read).
      const priorChangePath = tenantDocumentPath(metadata.organizationId, 'change_request', changeId(input.reviewRequestId, Number(request.round)))
      const priorChange = await transaction.get(priorChangePath)
      // Write phase.
      approvalIds.forEach((recordId, order) => transaction.create(
        tenantDocumentPath(metadata.organizationId, 'approval', recordId),
        { ...base(metadata.organizationId), reviewRequestId: input.reviewRequestId, round, reviewerUserId: reviewerUserIds[order], order, reviewedVersion: input.reviewedVersion, status: 'pending' },
      ))
      if (priorChange?.status === 'open') transaction.update(priorChangePath, { status: 'resolved', resolvedAt: this.clock.now(), updatedAt: SERVER_TIMESTAMP, version: Number(priorChange.version) + 1 })
      transaction.update(requestPath, {
        status: 'requested', round, reviewedVersion: input.reviewedVersion, approvalIds,
        version: input.expectedRequestVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { reviewRequestId: input.reviewRequestId, round, approvalIds },
        resourceType: 'review_request', resourceId: input.reviewRequestId,
        outbox: { type: 'review.resubmitted', version: 1, payload: { reviewRequestId: input.reviewRequestId, taskId: request.taskId, round } },
      }
    })
  }

  async delegate(metadata: ReviewMetadata, input: {
    approvalId: string
    delegateUserId: string
    expectedApprovalVersion: number
    reason: string
  }) {
    id.parse(input.approvalId); id.parse(input.delegateUserId); version.parse(input.expectedApprovalVersion)
    if (input.reason.trim().length < 5) throw new Error('DELEGATION_REASON_REQUIRED')
    const snapshot = await this.store.runTransaction(async (transaction) => {
      const approval = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'approval', input.approvalId), metadata.organizationId)
      const request = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'review_request', String(approval.reviewRequestId)), metadata.organizationId)
      return { approval, request }
    })
    if (snapshot.approval.reviewerUserId !== metadata.principal.userId) throw new Error('REVIEWER_IDENTITY_MISMATCH')
    const eligibility = await this.eligibility.validateReviewers({
      organizationId: metadata.organizationId, taskId: String(snapshot.request.taskId),
      reviewerUserIds: [input.delegateUserId], visibility: snapshot.request.visibility as 'internal' | 'client',
    })
    if (!eligibility.valid) throw new Error(eligibility.errors[0] ?? 'REVIEWER_NOT_ELIGIBLE')
    const context = await this.context(metadata, 'approval.delegate', String(snapshot.request.taskId), snapshot.request.visibility as 'internal' | 'client')
    return this.audit.execute(context, async (transaction) => {
      const approvalPath = tenantDocumentPath(metadata.organizationId, 'approval', input.approvalId)
      const approval = await owned(transaction, approvalPath, metadata.organizationId)
      if (approval.version !== input.expectedApprovalVersion || approval.status !== 'pending') throw new Error('APPROVAL_DECISION_IMMUTABLE')
      const requestPath = tenantDocumentPath(metadata.organizationId, 'review_request', String(approval.reviewRequestId))
      const request = await owned(transaction, requestPath, metadata.organizationId)
      if (!['requested', 'in_review'].includes(String(request.status))) throw new Error('REVIEW_REQUEST_NOT_ACTIVE')
      const delegatedId = approvalId(String(approval.reviewRequestId), Number(approval.round), input.delegateUserId)
      if (await transaction.get(tenantDocumentPath(metadata.organizationId, 'approval', delegatedId))) throw new Error('DELEGATE_ALREADY_ASSIGNED')
      transaction.update(approvalPath, {
        status: 'delegated', delegatedToUserId: input.delegateUserId, decisionReason: input.reason.trim(),
        decidedAt: this.clock.now(), version: input.expectedApprovalVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.create(tenantDocumentPath(metadata.organizationId, 'approval', delegatedId), {
        ...base(metadata.organizationId), reviewRequestId: approval.reviewRequestId, round: approval.round,
        reviewerUserId: input.delegateUserId, order: approval.order, reviewedVersion: approval.reviewedVersion,
        status: 'pending', delegatedFromApprovalId: input.approvalId,
      })
      const approvalIds = (request.approvalIds as string[]).map((recordId) => recordId === input.approvalId ? delegatedId : recordId)
      transaction.update(requestPath, { approvalIds, version: Number(request.version) + 1, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { originalApprovalId: input.approvalId, delegatedApprovalId: delegatedId },
        resourceType: 'approval', resourceId: input.approvalId,
        outbox: { type: 'approval.delegated', version: 1, payload: { reviewRequestId: approval.reviewRequestId, originalApprovalId: input.approvalId, delegatedApprovalId: delegatedId } },
      }
    })
  }

  async expire(metadata: ReviewMetadata, reviewRequestId: string, expectedRequestVersion: number) {
    id.parse(reviewRequestId); version.parse(expectedRequestVersion)
    const context = await this.context(metadata, 'task.override_transition')
    const now = this.clock.now()
    return this.audit.execute(context, async (transaction) => {
      const requestPath = tenantDocumentPath(metadata.organizationId, 'review_request', reviewRequestId)
      const request = await owned(transaction, requestPath, metadata.organizationId)
      if (request.version !== expectedRequestVersion || !['requested', 'in_review'].includes(String(request.status))) throw new Error('REVIEW_REQUEST_NOT_ACTIVE')
      if (!request.dueAt || String(request.dueAt) > now) throw new Error('REVIEW_NOT_EXPIRED')
      // Read phase — every pending approval is read before any write (Firestore transaction rule; the
      // loop previously read then updated each approval in turn).
      const pendingApprovalUpdates: { path: string; version: number }[] = []
      for (const recordId of request.approvalIds as string[]) {
        const approvalPath = tenantDocumentPath(metadata.organizationId, 'approval', recordId)
        const approval = await owned(transaction, approvalPath, metadata.organizationId)
        if (approval.status === 'pending') pendingApprovalUpdates.push({ path: approvalPath, version: Number(approval.version) + 1 })
      }
      // Write phase.
      for (const update of pendingApprovalUpdates) transaction.update(update.path, { status: 'expired', version: update.version, updatedAt: SERVER_TIMESTAMP })
      transaction.update(requestPath, { status: 'expired', completedAt: now, version: expectedRequestVersion + 1, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { reviewRequestId, status: 'expired' as const },
        resourceType: 'review_request', resourceId: reviewRequestId,
        outbox: { type: 'review.expired', version: 1, payload: { reviewRequestId, taskId: request.taskId } },
      }
    })
  }
}

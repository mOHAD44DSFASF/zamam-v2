import { tenantDocumentPath } from '@zamam/firestore'
import { ReviewService, buildReviewInboxQuery, type ReviewClock, type ReviewEligibilityPort } from '../../review/service.js'
import type { Deps } from '../deps.js'
import { readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createEligibilityPort(deps: Deps): ReviewEligibilityPort {
  return {
    async validateReviewers(input) {
      const errors: string[] = []
      for (const reviewerUserId of input.reviewerUserIds) {
        const employment = await readDoc(deps.firestore, tenantDocumentPath(input.organizationId, 'employment_profile', reviewerUserId))
        if (!employment || employment.status !== 'active') errors.push('REVIEWER_NOT_ELIGIBLE')
      }
      return { valid: errors.length === 0, errors }
    },
  }
}

const clock: ReviewClock = { now: () => new Date().toISOString() }

export function createReviewHandlers(deps: Deps): HandlerRegistry {
  const service = new ReviewService(deps.store, deps.authorization, createEligibilityPort(deps), clock)

  return {
    '/v1/reviews/inbox': async (context, input) => {
      await deps.authorization.require(context.principal, { permission: 'review.perform', organizationId: context.organizationId })
      const query = buildReviewInboxQuery({
        organizationId: context.organizationId, reviewerUserId: context.principal.userId,
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/approval`, query)
      return { items: page.items, nextCursor: page.nextCursor }
    },
    '/v1/reviews/decide': (context, input) => service.decide({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, {
      approvalId: requireString(input, 'approvalId'), expectedApprovalVersion: requireNumber(input, 'expectedApprovalVersion'),
      decision: requireString(input, 'decision') as 'approved' | 'rejected' | 'changes_requested',
      ...(typeof input.reason === 'string' ? { reason: input.reason } : {}),
    }),
  }
}

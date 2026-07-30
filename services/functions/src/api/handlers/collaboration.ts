import { tenantDocumentPath } from '@zamam/firestore'
import {
  CollaborationService, buildCommentQuery,
  type CollaborationClock, type CollaborationCommentPort, type CollaborationResourcePort,
} from '../../collaboration/service.js'
import type { Deps } from '../deps.js'
import { readDoc, resolveTaskOrProjectResource } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireBoolean, requireNumber, requireString } from '../registry.js'

function createResourcePort(deps: Deps): CollaborationResourcePort {
  return {
    resolve: (organizationId, type, id) => resolveTaskOrProjectResource(deps, organizationId, type, id),
    async validateMentionTargets(input) {
      if (input.visibility === 'internal') {
        const results = await Promise.all(input.userIds.map(async (userId) => {
          const employment = await readDoc(deps.firestore, tenantDocumentPath(input.organizationId, 'employment_profile', userId))
          return employment?.status === 'active' ? null : userId
        }))
        const invalidUserIds = results.filter((value): value is string => value !== null)
        return { valid: invalidUserIds.length === 0, invalidUserIds }
      }
      const clientId = input.resource.clientAccountId
      if (!clientId) return { valid: false, invalidUserIds: input.userIds }
      const contacts = await deps.firestore.collection(`v2Organizations/${input.organizationId}/client_contact`)
        .where('clientId', '==', clientId).where('portalStatus', '==', 'active').get()
      const eligible = new Set(contacts.docs.map((doc) => String(doc.data().userId)))
      const invalidUserIds = input.userIds.filter((userId) => !eligible.has(userId))
      return { valid: invalidUserIds.length === 0, invalidUserIds }
    },
  }
}

function createCommentPort(deps: Deps): CollaborationCommentPort {
  return { get: (organizationId, commentId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'comment', commentId)) }
}

const clock: CollaborationClock = { now: () => new Date().toISOString() }

export function createCollaborationHandlers(deps: Deps): HandlerRegistry {
  const service = new CollaborationService(deps.store, deps.authorization, createResourcePort(deps), createCommentPort(deps), clock)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.create>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/collaboration/query': async (context, input) => {
      const resourceType = requireString(input, 'resourceType') as 'task' | 'project'
      const resourceId = requireString(input, 'resourceId')
      await deps.authorization.require(context.principal, {
        permission: context.principal.principalType === 'client' ? 'comment.client.view' : 'comment.internal.view',
        organizationId: context.organizationId,
        resource: { type: resourceType, id: resourceId, organizationId: context.organizationId, visibility: 'internal' },
      })
      const query = buildCommentQuery({
        organizationId: context.organizationId, resourceType, resourceId,
        principalType: context.principal.principalType === 'client' ? 'client' : 'member',
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/comment`, query)
      return { items: page.items, nextCursor: page.nextCursor }
    },
    '/v1/comments/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), resourceType: requireString(input, 'resourceType') as 'task' | 'project',
      resourceId: requireString(input, 'resourceId'), body: requireString(input, 'body'),
      visibility: requireString(input, 'visibility') as 'internal' | 'client',
      ...(typeof input.parentCommentId === 'string' ? { parentCommentId: input.parentCommentId } : {}),
      ...(typeof input.linkedReviewRequestId === 'string' ? { linkedReviewRequestId: input.linkedReviewRequestId } : {}),
      mentionedUserIds: Array.isArray(input.mentionedUserIds) ? input.mentionedUserIds.filter((v): v is string => typeof v === 'string') : [],
    }),
    '/v1/comments/delete': (context, input) => service.tombstone(
      metadata(context), requireString(input, 'commentId'), requireNumber(input, 'expectedVersion'),
    ),
    '/v1/reactions/set': (context, input) => service.setReaction(
      metadata(context), requireString(input, 'commentId'),
      requireString(input, 'type') as 'like' | 'celebrate' | 'support' | 'insightful', requireBoolean(input, 'active'),
    ),
    '/v1/tasks/watch': (context, input) => service.setTaskWatch(
      metadata(context), requireString(input, 'taskId'), requireBoolean(input, 'active'),
    ),
  }
}

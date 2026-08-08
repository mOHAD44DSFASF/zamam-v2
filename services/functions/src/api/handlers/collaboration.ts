import { tenantDocumentPath } from '@zamam/firestore'
import {
  CollaborationService, buildCommentQuery,
  type CollaborationClock, type CollaborationCommentPort, type CollaborationResourcePort,
} from '../../collaboration/service.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, orgPath, readDoc, resolveNames, resolveTaskOrProjectResource } from '../deps.js'
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
    // Bug 2 (Comments tab was dead): this used to return { items, nextCursor } — raw comment docs, none of
    // the shape the frontend's CollaborationSnapshot type actually needs (resource/mentionCandidates/
    // watched/capabilities, or even per-comment authorName/mine/locked/mentions/reactions). That mismatch
    // threw an uncaught exception in the UI and was previously only guarded against, not fixed. This now
    // composes the real snapshot the frontend has always expected.
    '/v1/collaboration/query': async (context, input) => {
      const resourceType = requireString(input, 'resourceType') as 'task' | 'project'
      const resourceId = requireString(input, 'resourceId')
      const isClient = context.principal.principalType === 'client'
      await deps.authorization.require(context.principal, {
        permission: isClient ? 'comment.client.view' : 'comment.internal.view',
        organizationId: context.organizationId,
        resource: { type: resourceType, id: resourceId, organizationId: context.organizationId, visibility: 'internal' },
      })
      const resourceDoc = await readDoc(deps.firestore, orgPath(context.organizationId, resourceType, resourceId))
      if (!resourceDoc) throw new Error('ENTITY_NOT_FOUND')

      const query = buildCommentQuery({
        organizationId: context.organizationId, resourceType, resourceId,
        principalType: isClient ? 'client' : 'member',
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/comment`, query)
      const comments = page.items

      const [mentionPages, reactionPages] = await Promise.all([
        Promise.all(comments.map((comment) => listQuery(deps, context.organizationId, 'mention', {
          filters: [{ field: 'commentId', operator: '==', value: comment.id }, { field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'createdAt', direction: 'asc' }], limit: 50,
        }))),
        Promise.all(comments.map((comment) => listQuery(deps, context.organizationId, 'reaction', {
          filters: [{ field: 'commentId', operator: '==', value: comment.id }, { field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'createdAt', direction: 'asc' }], limit: 100,
        }))),
      ])
      const authorIds = comments.map((c) => String(c.authorUserId ?? ''))
      const mentionedIds = mentionPages.flatMap((p) => p.items.map((m) => String(m.mentionedUserId ?? '')))
      const authorNames = await resolveNames(deps, context.organizationId, 'user_profile', [...authorIds, ...mentionedIds], 'displayName')

      const items = comments.map((comment, index) => {
        const mentions = mentionPages[index]!.items.map((m) => ({
          userId: String(m.mentionedUserId), displayName: authorNames.get(String(m.mentionedUserId)) ?? String(m.mentionedUserId),
        }))
        const reactionsByType = new Map<string, { count: number; selected: boolean }>()
        for (const reaction of reactionPages[index]!.items) {
          const type = String(reaction.type)
          const entry = reactionsByType.get(type) ?? { count: 0, selected: false }
          entry.count += 1
          if (reaction.userId === context.principal.userId) entry.selected = true
          reactionsByType.set(type, entry)
        }
        return {
          id: String(comment.id), authorUserId: String(comment.authorUserId), authorName: authorNames.get(String(comment.authorUserId)) ?? String(comment.authorUserId),
          body: String(comment.body ?? ''), visibility: comment.visibility, status: comment.status,
          createdAt: comment.createdAt, editedAt: comment.editedAt ?? null, version: Number(comment.version ?? 1),
          mine: comment.authorUserId === context.principal.userId, locked: Boolean(comment.lockedAt),
          mentions, reactions: [...reactionsByType.entries()].map(([type, value]) => ({ type, ...value })),
        }
      })

      const [mentionCandidatePage, watcherPage] = await Promise.all([
        isClient ? Promise.resolve({ items: [] as Record<string, unknown>[] }) : listQuery(deps, context.organizationId, 'organization_membership', {
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
        }),
        resourceType === 'task' ? listQuery(deps, context.organizationId, 'task_watcher', {
          filters: [
            { field: 'taskId', operator: '==', value: resourceId },
            { field: 'userId', operator: '==', value: context.principal.userId },
            { field: 'status', operator: '==', value: 'active' },
          ],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
        }) : Promise.resolve({ items: [] as Record<string, unknown>[] }),
      ])
      const candidateIds = mentionCandidatePage.items.map((m) => String(m.userId))
      const candidateNames = await resolveNames(deps, context.organizationId, 'user_profile', candidateIds, 'displayName')
      const mentionCandidates = candidateIds
        .filter((userId) => userId !== context.principal.userId)
        .map((userId) => ({ userId, displayName: candidateNames.get(userId) ?? userId }))

      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, isClient
        ? { createInternal: 'comment.internal.create' /* always false for a client principal, evaluate() denies cross-type permissions safely */, createClient: 'comment.client.create', updateOwn: 'comment.client.update', deleteOwn: 'comment.client.delete', react: 'reaction.create', watch: 'task.watch' }
        : { createInternal: 'comment.internal.create', createClient: 'comment.client.create', updateOwn: 'comment.internal.update', deleteOwn: 'comment.internal.delete', react: 'reaction.create', watch: 'task.watch' })

      return {
        resource: { type: resourceType, id: resourceId, title: String(resourceDoc.title ?? resourceDoc.name ?? ''), clientVisible: Boolean(resourceDoc.clientVisible) },
        comments: items,
        mentionCandidates,
        watched: watcherPage.items.length > 0,
        capabilities,
        nextCursor: page.nextCursor,
      }
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

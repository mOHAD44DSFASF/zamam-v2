import { createHash } from 'node:crypto'
import type {
  AuthorizationPrincipal, AuthorizationRequest, Permission, ResourceAuthorizationContext,
} from '@zamam/authorization'
import { commentEditableUntil, normalizeCommentBody, SCHEMA_VERSION } from '@zamam/domain'
import {
  SERVER_TIMESTAMP, tenantDocumentPath,
  type AtomicStore, type AtomicTransaction, type PageQuery, type StoredDocument,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const version = z.number().int().positive()
const resourceType = z.enum(['task', 'project'])
const visibility = z.enum(['internal', 'client'])
const reactionType = z.enum(['like', 'celebrate', 'support', 'insightful'])
const createSchema = z.object({
  id,
  resourceType,
  resourceId: id,
  body: z.string(),
  visibility,
  parentCommentId: id.optional(),
  linkedReviewRequestId: id.optional(),
  mentionedUserIds: z.array(id).max(20).default([]),
}).strict()

export interface CollaborationAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface CollaborationResourcePort {
  resolve(organizationId: string, type: 'task' | 'project', id: string): Promise<ResourceAuthorizationContext | null>
  validateMentionTargets(input: {
    organizationId: string
    resource: ResourceAuthorizationContext
    visibility: 'internal' | 'client'
    userIds: readonly string[]
  }): Promise<{ valid: boolean; invalidUserIds: readonly string[] }>
}
export interface CollaborationCommentPort {
  get(organizationId: string, commentId: string): Promise<StoredDocument | null>
}
export interface CollaborationClock { now(): string }
export interface CollaborationMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}

const base = (organizationId: string) => ({
  organizationId,
  schemaVersion: SCHEMA_VERSION,
  version: 1,
  createdAt: SERVER_TIMESTAMP,
  updatedAt: SERVER_TIMESTAMP,
})
const deterministicId = (...parts: string[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 36)
const owned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}

export function buildCommentQuery(input: {
  organizationId: string
  resourceType: 'task' | 'project'
  resourceId: string
  principalType: 'member' | 'client'
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); id.parse(input.resourceId)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId,
    entityKind: 'comment',
    filters: [
      { field: 'resourceType', operator: '==', value: input.resourceType },
      { field: 'resourceId', operator: '==', value: input.resourceId },
      { field: 'status', operator: '==', value: 'active' },
      input.principalType === 'client'
        ? { field: 'visibility', operator: '==', value: 'client' }
        : { field: 'visibility', operator: 'in', value: ['internal', 'client'] },
    ],
    orderBy: [{ field: 'createdAt', direction: 'asc' }],
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export function buildMentionInboxQuery(input: {
  organizationId: string
  userId: string
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); id.parse(input.userId)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId,
    entityKind: 'mention',
    filters: [
      { field: 'mentionedUserId', operator: '==', value: input.userId },
      { field: 'status', operator: '==', value: 'active' },
    ],
    orderBy: [{ field: 'createdAt', direction: 'desc' }],
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export function buildResourceActivityQuery(input: {
  organizationId: string
  resourceType: 'task' | 'project'
  resourceId: string
  principalType: 'member' | 'client'
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  if (input.principalType === 'client') throw new Error('CLIENT_ACTIVITY_PROJECTION_REQUIRED')
  id.parse(input.organizationId); id.parse(input.resourceId)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId,
    entityKind: 'audit_event',
    filters: [
      { field: 'resourceType', operator: '==', value: input.resourceType },
      { field: 'resourceId', operator: '==', value: input.resourceId },
    ],
    orderBy: [{ field: 'occurredAt', direction: 'desc' }],
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class CollaborationService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: CollaborationAuthorizationGate,
    private readonly resources: CollaborationResourcePort,
    private readonly comments: CollaborationCommentPort,
    private readonly clock: CollaborationClock,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  private async resource(metadata: CollaborationMetadata, type: 'task' | 'project', resourceId: string) {
    const resource = await this.resources.resolve(metadata.organizationId, type, resourceId)
    if (!resource) throw new Error('ENTITY_NOT_FOUND')
    if (resource.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    return resource
  }

  private async context(
    metadata: CollaborationMetadata,
    permission: Permission,
    resource: ResourceAuthorizationContext,
    requestedVisibility: 'internal' | 'client',
  ) {
    if (metadata.principal.principalType === 'client' && requestedVisibility !== 'client') {
      throw new Error('CLIENT_INTERNAL_CHANNEL_DENIED')
    }
    if (requestedVisibility === 'client' && resource.visibility !== 'client') {
      throw new Error('CLIENT_COMMENT_RESOURCE_NOT_VISIBLE')
    }
    await this.authorization.require(metadata.principal, {
      permission,
      organizationId: metadata.organizationId,
      resource: { ...resource, visibility: requestedVisibility },
    })
    return {
      organizationId: metadata.organizationId,
      actorUserId: metadata.principal.userId,
      permission,
      correlationId: metadata.correlationId,
      idempotencyKey: metadata.idempotencyKey,
      fingerprint: metadata.fingerprint,
    }
  }

  async create(metadata: CollaborationMetadata, raw: z.input<typeof createSchema>) {
    const input = createSchema.parse(raw)
    const body = normalizeCommentBody(input.body)
    const mentionedUserIds = [...new Set(input.mentionedUserIds)]
    if (mentionedUserIds.length !== input.mentionedUserIds.length) throw new Error('DUPLICATE_MENTION')
    const resource = await this.resource(metadata, input.resourceType, input.resourceId)
    const permission = `comment.${input.visibility}.create` as Permission
    const context = await this.context(metadata, permission, resource, input.visibility)
    if (mentionedUserIds.length) {
      await this.authorization.require(metadata.principal, {
        permission: 'mention.create',
        organizationId: metadata.organizationId,
        resource: { ...resource, visibility: input.visibility },
      })
      const result = await this.resources.validateMentionTargets({
        organizationId: metadata.organizationId,
        resource,
        visibility: input.visibility,
        userIds: mentionedUserIds,
      })
      if (!result.valid) throw new Error('MENTION_TARGET_NOT_VISIBLE')
    }
    const now = this.clock.now()
    const editableUntil = commentEditableUntil(now)
    return this.audit.execute(context, async (transaction) => {
      await owned(
        transaction,
        tenantDocumentPath(metadata.organizationId, input.resourceType, input.resourceId),
        metadata.organizationId,
      )
      if (input.parentCommentId) {
        const parent = await owned(
          transaction,
          tenantDocumentPath(metadata.organizationId, 'comment', input.parentCommentId),
          metadata.organizationId,
        )
        if (
          parent.status !== 'active'
          || parent.resourceType !== input.resourceType
          || parent.resourceId !== input.resourceId
          || parent.visibility !== input.visibility
        ) throw new Error('COMMENT_PARENT_SCOPE_CONFLICT')
      }
      if (input.linkedReviewRequestId) {
        const review = await owned(
          transaction,
          tenantDocumentPath(metadata.organizationId, 'review_request', input.linkedReviewRequestId),
          metadata.organizationId,
        )
        if (input.resourceType !== 'task' || review.taskId !== input.resourceId) {
          throw new Error('COMMENT_REVIEW_SCOPE_CONFLICT')
        }
      }
      const path = tenantDocumentPath(metadata.organizationId, 'comment', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, {
        ...base(metadata.organizationId),
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        authorUserId: metadata.principal.userId,
        body,
        visibility: input.visibility,
        status: 'active',
        editableUntil,
        ...(input.parentCommentId ? { parentCommentId: input.parentCommentId } : {}),
        ...(input.linkedReviewRequestId
          ? { linkedReviewRequestId: input.linkedReviewRequestId, lockedAt: SERVER_TIMESTAMP }
          : {}),
      })
      for (const mentionedUserId of mentionedUserIds) {
        const mentionId = deterministicId(input.id, mentionedUserId)
        transaction.create(tenantDocumentPath(metadata.organizationId, 'mention', mentionId), {
          ...base(metadata.organizationId),
          commentId: input.id,
          mentionedUserId,
          visibility: input.visibility,
          status: 'active',
        })
      }
      if (input.resourceType === 'task') {
        const watcherId = deterministicId(input.resourceId, metadata.principal.userId)
        const watcherPath = tenantDocumentPath(metadata.organizationId, 'task_watcher', watcherId)
        if (!await transaction.get(watcherPath)) {
          transaction.create(watcherPath, {
            ...base(metadata.organizationId),
            taskId: input.resourceId,
            userId: metadata.principal.userId,
            source: 'comment',
            status: 'active',
          })
        }
      }
      return {
        result: { commentId: input.id, version: 1, mentionCount: mentionedUserIds.length },
        resourceType: 'comment',
        resourceId: input.id,
        outbox: {
          type: 'comment.created',
          version: 1,
          payload: {
            commentId: input.id,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            visibility: input.visibility,
            mentionedUserIds,
          },
        },
      }
    })
  }

  async update(metadata: CollaborationMetadata, commentId: string, expectedVersion: number, nextBody: string) {
    id.parse(commentId); version.parse(expectedVersion)
    const body = normalizeCommentBody(nextBody)
    const snapshot = await this.comments.get(metadata.organizationId, commentId)
    if (!snapshot) throw new Error('ENTITY_NOT_FOUND')
    if (snapshot.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    const type = resourceType.parse(snapshot.resourceType)
    const commentVisibility = visibility.parse(snapshot.visibility)
    const resource = await this.resource(metadata, type, String(snapshot.resourceId))
    const context = await this.context(
      metadata,
      `comment.${commentVisibility}.update` as Permission,
      { ...resource, ownerUserId: String(snapshot.authorUserId) },
      commentVisibility,
    )
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'comment', commentId)
      const comment = await owned(transaction, path, metadata.organizationId)
      if (comment.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      if (comment.status !== 'active') throw new Error('COMMENT_NOT_ACTIVE')
      if (comment.authorUserId !== metadata.principal.userId) throw new Error('COMMENT_AUTHOR_REQUIRED')
      if (comment.lockedAt) throw new Error('COMMENT_EVIDENCE_LOCKED')
      if (Date.parse(this.clock.now()) > Date.parse(String(comment.editableUntil))) {
        throw new Error('COMMENT_EDIT_WINDOW_EXPIRED')
      }
      transaction.update(path, {
        body,
        editedAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
        version: expectedVersion + 1,
      })
      return {
        result: { commentId, version: expectedVersion + 1 },
        resourceType: 'comment',
        resourceId: commentId,
        outbox: { type: 'comment.updated', version: 1, payload: { commentId } },
      }
    })
  }

  async tombstone(metadata: CollaborationMetadata, commentId: string, expectedVersion: number) {
    id.parse(commentId); version.parse(expectedVersion)
    const snapshot = await this.comments.get(metadata.organizationId, commentId)
    if (!snapshot) throw new Error('ENTITY_NOT_FOUND')
    if (snapshot.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    const type = resourceType.parse(snapshot.resourceType)
    const commentVisibility = visibility.parse(snapshot.visibility)
    const resource = await this.resource(metadata, type, String(snapshot.resourceId))
    const context = await this.context(
      metadata,
      `comment.${commentVisibility}.delete` as Permission,
      { ...resource, ownerUserId: String(snapshot.authorUserId) },
      commentVisibility,
    )
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'comment', commentId)
      const comment = await owned(transaction, path, metadata.organizationId)
      if (comment.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      if (comment.status !== 'active') throw new Error('COMMENT_NOT_ACTIVE')
      if (comment.lockedAt) throw new Error('COMMENT_EVIDENCE_LOCKED')
      if (
        comment.authorUserId !== metadata.principal.userId
        || Date.parse(this.clock.now()) > Date.parse(String(comment.editableUntil))
      ) throw new Error('COMMENT_DELETE_NOT_ALLOWED')
      transaction.update(path, {
        body: '[deleted]',
        status: 'deleted',
        deletedAt: SERVER_TIMESTAMP,
        updatedAt: SERVER_TIMESTAMP,
        version: expectedVersion + 1,
      })
      return {
        result: { commentId, version: expectedVersion + 1, status: 'deleted' as const },
        resourceType: 'comment',
        resourceId: commentId,
        outbox: { type: 'comment.deleted', version: 1, payload: { commentId } },
      }
    })
  }

  async setReaction(
    metadata: CollaborationMetadata,
    commentId: string,
    rawType: z.input<typeof reactionType>,
    active: boolean,
  ) {
    id.parse(commentId)
    const type = reactionType.parse(rawType)
    const comment = await this.comments.get(metadata.organizationId, commentId)
    if (!comment) throw new Error('ENTITY_NOT_FOUND')
    if (comment.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    if (comment.status !== 'active') throw new Error('COMMENT_NOT_ACTIVE')
    const commentVisibility = visibility.parse(comment.visibility)
    const parentType = resourceType.parse(comment.resourceType)
    const resource = await this.resource(metadata, parentType, String(comment.resourceId))
    const context = await this.context(
      metadata,
      active ? 'reaction.create' : 'reaction.delete',
      resource,
      commentVisibility,
    )
    const reactionId = deterministicId(commentId, metadata.principal.userId, type)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'reaction', reactionId)
      const current = await transaction.get(path)
      if (!current && !active) {
        return {
          result: { reactionId, status: 'removed' as const },
          resourceType: 'reaction',
          resourceId: reactionId,
          outbox: { type: 'reaction.remove_ignored', version: 1, payload: { commentId, type } },
        }
      }
      if (!current) {
        transaction.create(path, {
          ...base(metadata.organizationId),
          commentId,
          userId: metadata.principal.userId,
          type,
          status: 'active',
        })
      } else {
        transaction.update(path, {
          status: active ? 'active' : 'removed',
          version: Number(current.version) + 1,
          updatedAt: SERVER_TIMESTAMP,
        })
      }
      return {
        result: { reactionId, status: active ? 'active' as const : 'removed' as const },
        resourceType: 'reaction',
        resourceId: reactionId,
        outbox: { type: `reaction.${active ? 'added' : 'removed'}`, version: 1, payload: { commentId, type } },
      }
    })
  }

  async setTaskWatch(metadata: CollaborationMetadata, taskId: string, active: boolean) {
    id.parse(taskId)
    const resource = await this.resource(metadata, 'task', taskId)
    const context = await this.context(metadata, 'task.watch', resource, resource.visibility === 'client' ? 'client' : 'internal')
    const watcherId = deterministicId(taskId, metadata.principal.userId)
    return this.audit.execute(context, async (transaction) => {
      await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', taskId), metadata.organizationId)
      const path = tenantDocumentPath(metadata.organizationId, 'task_watcher', watcherId)
      const current = await transaction.get(path)
      if (!current) {
        transaction.create(path, {
          ...base(metadata.organizationId),
          taskId,
          userId: metadata.principal.userId,
          source: 'explicit',
          status: active ? 'active' : 'ended',
        })
      } else {
        transaction.update(path, {
          status: active ? 'active' : 'ended',
          version: Number(current.version) + 1,
          updatedAt: SERVER_TIMESTAMP,
        })
      }
      return {
        result: { watcherId, status: active ? 'active' as const : 'ended' as const },
        resourceType: 'task_watcher',
        resourceId: watcherId,
        outbox: { type: `task.watcher.${active ? 'added' : 'removed'}`, version: 1, payload: { taskId } },
      }
    })
  }
}

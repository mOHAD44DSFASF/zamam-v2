import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, type AtomicStore, type PageQuery, type PageResult, type StoredDocument } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const filterSchema = z.object({
  statuses: z.array(z.enum(['draft', 'ready', 'in_progress', 'blocked', 'in_review', 'approved', 'completed', 'cancelled', 'archived'])).max(9).optional(),
  priorities: z.array(z.enum(['low', 'medium', 'high', 'urgent'])).max(4).optional(),
  projectId: id.optional(),
  workspaceId: id.optional(),
  dueBefore: z.string().datetime().optional(),
  presentation: z.enum(['list', 'board', 'calendar', 'timeline']).optional(),
}).strict()

export interface TaskQueryAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface TaskQueryStore {
  list<T>(query: PageQuery): Promise<PageResult<T>>
  getTasksByIds(organizationId: string, taskIds: readonly string[]): Promise<readonly StoredDocument[]>
}
export interface TaskSearchPort {
  searchTaskIds(input: {
    organizationId: string
    query: string
    permittedProjectIds?: readonly string[]
    limit: number
  }): Promise<readonly string[]>
}
export type TaskViewScope =
  | { type: 'self'; userId: string }
  | { type: 'team'; teamId: string }
  | { type: 'project'; projectId: string }
  | { type: 'organization' }

export function buildTaskViewQuery(input: {
  organizationId: string
  scope: TaskViewScope
  filters?: unknown
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId)
  const filters = filterSchema.parse(input.filters ?? {})
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  if (input.scope.type === 'self') {
    return {
      organizationId: input.organizationId, entityKind: 'task_assignment',
      filters: [
        { field: 'userId', operator: '==', value: input.scope.userId },
        { field: 'status', operator: '==', value: 'accepted' },
      ],
      orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    }
  }
  if (input.scope.type === 'team') {
    return {
      organizationId: input.organizationId, entityKind: 'task_assignment',
      filters: [
        { field: 'teamId', operator: '==', value: input.scope.teamId },
        { field: 'status', operator: '==', value: 'accepted' },
      ],
      orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    }
  }
  if (input.scope.type === 'project' && filters.projectId && filters.projectId !== input.scope.projectId) {
    throw new Error('FILTER_SCOPE_ESCALATION')
  }
  const scopeProjectId = input.scope.type === 'project' ? input.scope.projectId : filters.projectId
  return {
    organizationId: input.organizationId, entityKind: 'task',
    filters: [
      ...(scopeProjectId ? [{ field: 'projectId', operator: '==' as const, value: scopeProjectId }] : []),
      ...(filters.workspaceId ? [{ field: 'workspaceId', operator: '==' as const, value: filters.workspaceId }] : []),
      ...(filters.statuses?.length ? [{ field: 'status', operator: 'in' as const, value: filters.statuses }] : []),
      ...(filters.priorities?.length ? [{ field: 'priority', operator: 'in' as const, value: filters.priorities }] : []),
      ...(filters.dueBefore ? [{ field: 'dueAt', operator: '<=' as const, value: filters.dueBefore }] : []),
    ],
    orderBy: [{ field: filters.dueBefore ? 'dueAt' : 'updatedAt', direction: filters.dueBefore ? 'asc' : 'desc' }],
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class TaskQueryService {
  constructor(
    private readonly store: TaskQueryStore,
    private readonly authorization: TaskQueryAuthorizationGate,
    private readonly search: TaskSearchPort,
  ) {}

  async list(principal: AuthorizationPrincipal, input: {
    organizationId: string
    scope: TaskViewScope
    filters?: unknown
    limit?: number
    cursor?: readonly unknown[]
  }) {
    const permission = input.scope.type === 'organization' ? 'task.view_all' : 'task.view'
    await this.authorization.require(principal, {
      permission, organizationId: input.organizationId,
      resource: {
        type: input.scope.type, id: input.scope.type === 'organization' ? input.organizationId : Object.values(input.scope)[1] as string,
        organizationId: input.organizationId,
        ...(input.scope.type === 'team' ? { teamId: input.scope.teamId } : {}),
        ...(input.scope.type === 'project' ? { projectId: input.scope.projectId } : {}),
        ...(input.scope.type === 'self' ? { ownerUserId: input.scope.userId } : {}),
        visibility: 'internal',
      },
    })
    const query = buildTaskViewQuery(input)
    const page = await this.store.list<StoredDocument>(query)
    if (input.scope.type !== 'self' && input.scope.type !== 'team') return page
    const taskIds = [...new Set(page.items.map(({ taskId }) => String(taskId)).filter(Boolean))]
    if (taskIds.length > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
    return { items: await this.store.getTasksByIds(input.organizationId, taskIds), nextCursor: page.nextCursor }
  }

  async searchTasks(principal: AuthorizationPrincipal, input: {
    organizationId: string
    query: string
    permittedProjectIds?: readonly string[]
    limit?: number
  }) {
    await this.authorization.require(principal, { permission: 'search.use', organizationId: input.organizationId })
    const query = input.query.trim()
    const limit = input.limit ?? 20
    if (query.length < 2 || query.length > 120) throw new Error('INVALID_SEARCH_QUERY')
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('UNBOUNDED_QUERY_DENIED')
    const ids = await this.search.searchTaskIds({
      organizationId: input.organizationId, query,
      ...(input.permittedProjectIds ? { permittedProjectIds: input.permittedProjectIds } : {}),
      limit,
    })
    if (ids.length > limit) throw new Error('SEARCH_PROVIDER_LIMIT_VIOLATION')
    return this.store.getTasksByIds(input.organizationId, ids)
  }
}

const savedViewSchema = z.object({
  id, name: z.string().trim().min(2).max(80), resourceType: z.literal('task'),
  filters: filterSchema, visibility: z.enum(['private', 'team', 'organization']),
  teamId: id.optional(),
}).strict()
export class SavedTaskViewService {
  private readonly audit: AuditCommandService
  constructor(private readonly store: AtomicStore, private readonly authorization: TaskQueryAuthorizationGate, audit?: AuditCommandService) {
    this.audit = audit ?? new AuditCommandService(store)
  }
  async create(metadata: {
    organizationId: string
    principal: AuthorizationPrincipal
    correlationId: string
    idempotencyKey: string
    fingerprint: string
  }, raw: z.input<typeof savedViewSchema>) {
    const input = savedViewSchema.parse(raw)
    if (input.visibility === 'team' && !input.teamId) throw new Error('SAVED_VIEW_TEAM_REQUIRED')
    await this.authorization.require(metadata.principal, {
      permission: input.visibility === 'private' ? 'saved_view.create' : 'saved_view.share',
      organizationId: metadata.organizationId,
      ...(input.teamId ? { resource: { type: 'team', id: input.teamId, teamId: input.teamId, organizationId: metadata.organizationId, visibility: 'internal' } } : {}),
    })
    return this.audit.execute({
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId,
      permission: input.visibility === 'private' ? 'saved_view.create' : 'saved_view.share',
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }, async (transaction) => {
      const path = `v2Organizations/${metadata.organizationId}/saved_view/${input.id}`
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, {
        organizationId: metadata.organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
        createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        ownerUserId: metadata.principal.userId, ...input,
      })
      return {
        result: { savedViewId: input.id, version: 1 },
        resourceType: 'saved_view', resourceId: input.id,
        outbox: { type: 'saved_view.created', version: 1, payload: { savedViewId: input.id } },
      }
    })
  }
}

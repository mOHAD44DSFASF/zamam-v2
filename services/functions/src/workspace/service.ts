import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest, Permission } from '@zamam/authorization'
import { SCHEMA_VERSION, assertWorkspaceScope, normalizeWorkspaceName } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type AtomicTransaction, type PageQuery } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const createSchema = z.object({
  id,
  name: z.string().min(2).max(160),
  visibility: z.enum(['private', 'team', 'project']),
  projectId: id.optional(),
  departmentId: id.optional(),
  ownerTeamId: id.optional(),
}).strict()
const memberSchema = z.object({
  workspaceId: id,
  userId: id,
  membershipRole: z.enum(['manager', 'supervisor', 'member', 'viewer']),
  source: z.enum(['explicit', 'project']).default('explicit'),
}).strict()

export interface WorkspaceAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface WorkspaceCommandMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface WorkspaceLifecyclePort {
  openTaskCount(organizationId: string, workspaceId: string): Promise<number>
  hasActiveInternalProjectMembership(organizationId: string, projectId: string, userId: string): Promise<boolean>
}

const base = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const memberId = (workspaceId: string, userId: string) =>
  `wm-${createHash('sha256').update(`${workspaceId}:${userId}`).digest('hex').slice(0, 32)}`
const owned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}

export function buildWorkspaceMembershipQuery(input: {
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
    entityKind: 'workspace_member',
    filters: [
      { field: 'userId', operator: '==', value: input.userId },
      { field: 'status', operator: '==', value: 'active' },
    ],
    orderBy: [{ field: 'workspaceId', direction: 'asc' }],
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class WorkspaceService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: WorkspaceAuthorizationGate,
    private readonly lifecycle: WorkspaceLifecyclePort,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  private async authorized(metadata: WorkspaceCommandMetadata, permission: Permission, workspaceId?: string) {
    await this.authorization.require(metadata.principal, {
      permission,
      organizationId: metadata.organizationId,
      ...(workspaceId ? { resource: {
        type: 'workspace', id: workspaceId, organizationId: metadata.organizationId,
        workspaceId, visibility: 'internal',
      } } : {}),
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async create(metadata: WorkspaceCommandMetadata, raw: z.input<typeof createSchema>) {
    const parsed = createSchema.parse(raw)
    const input = { ...parsed, name: normalizeWorkspaceName(parsed.name) }
    assertWorkspaceScope(input)
    const context = await this.authorized(metadata, 'workspace.create', input.id)
    return this.audit.execute(context, async (transaction) => {
      if (input.projectId) {
        const project = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'project', input.projectId), metadata.organizationId)
        if (!['planned', 'active', 'on_hold'].includes(String(project.status))) throw new Error('WORKSPACE_PROJECT_NOT_ACTIVE')
        if (input.departmentId && project.departmentId && project.departmentId !== input.departmentId) throw new Error('WORKSPACE_PROJECT_DEPARTMENT_CONFLICT')
      }
      if (input.departmentId) {
        const department = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'department', input.departmentId), metadata.organizationId)
        if (department.status !== 'active') throw new Error('WORKSPACE_DEPARTMENT_NOT_ACTIVE')
      }
      if (input.ownerTeamId) {
        const team = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'team', input.ownerTeamId), metadata.organizationId)
        if (team.status !== 'active' || team.departmentId !== input.departmentId) throw new Error('WORKSPACE_TEAM_SCOPE_CONFLICT')
      }
      const path = tenantDocumentPath(metadata.organizationId, 'workspace', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, { ...base(metadata.organizationId), ...input, createdBy: metadata.principal.userId, status: 'active' })
      const creatorMembershipId = memberId(input.id, metadata.principal.userId)
      transaction.create(tenantDocumentPath(metadata.organizationId, 'workspace_member', creatorMembershipId), {
        ...base(metadata.organizationId), workspaceId: input.id, userId: metadata.principal.userId,
        membershipRole: 'manager', source: 'explicit', status: 'active', joinedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { workspaceId: input.id, version: 1 },
        resourceType: 'workspace', resourceId: input.id,
        outbox: { type: 'workspace.created', version: 1, payload: { workspaceId: input.id } },
      }
    })
  }

  async addMember(metadata: WorkspaceCommandMetadata, raw: z.input<typeof memberSchema>) {
    const input = memberSchema.parse(raw)
    const context = await this.authorized(metadata, 'workspace.member.manage', input.workspaceId)
    if (input.source === 'project') {
      const workspace = await this.store.runTransaction((transaction) =>
        owned(transaction, tenantDocumentPath(metadata.organizationId, 'workspace', input.workspaceId), metadata.organizationId))
      if (!workspace.projectId) throw new Error('WORKSPACE_PROJECT_REQUIRED')
      if (!await this.lifecycle.hasActiveInternalProjectMembership(metadata.organizationId, String(workspace.projectId), input.userId)) {
        throw new Error('PROJECT_MEMBERSHIP_REQUIRED')
      }
    }
    return this.audit.execute(context, async (transaction) => {
      const workspace = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workspace', input.workspaceId), metadata.organizationId)
      if (workspace.status !== 'active') throw new Error('WORKSPACE_NOT_ACTIVE')
      const employment = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'employment_profile', input.userId), metadata.organizationId)
      if (employment.status !== 'active') throw new Error('WORKSPACE_MEMBER_NOT_ACTIVE')
      const membershipId = memberId(input.workspaceId, input.userId)
      const path = tenantDocumentPath(metadata.organizationId, 'workspace_member', membershipId)
      const existing = await transaction.get(path)
      if (existing?.status === 'active') throw new Error('WORKSPACE_MEMBERSHIP_ALREADY_ACTIVE')
      const values = { workspaceId: input.workspaceId, userId: input.userId, membershipRole: input.membershipRole, source: input.source, status: 'active', joinedAt: SERVER_TIMESTAMP }
      if (existing) transaction.update(path, { ...values, version: Number(existing.version) + 1, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(path, { ...base(metadata.organizationId), ...values })
      return {
        result: { membershipId, version: existing ? Number(existing.version) + 1 : 1 },
        resourceType: 'workspace_member', resourceId: membershipId,
        outbox: { type: 'workspace.member_added', version: 1, payload: { workspaceId: input.workspaceId, userId: input.userId } },
      }
    })
  }

  async archive(metadata: WorkspaceCommandMetadata, workspaceId: string, expectedVersion: number) {
    id.parse(workspaceId)
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('INVALID_VERSION')
    const context = await this.authorized(metadata, 'workspace.archive', workspaceId)
    if (await this.lifecycle.openTaskCount(metadata.organizationId, workspaceId) > 0) throw new Error('WORKSPACE_HAS_OPEN_TASKS')
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'workspace', workspaceId)
      const workspace = await owned(transaction, path, metadata.organizationId)
      if (workspace.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      if (workspace.status !== 'active') throw new Error('INVALID_WORKSPACE_STATUS_TRANSITION')
      transaction.update(path, { status: 'archived', archivedAt: SERVER_TIMESTAMP, version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { workspaceId, version: expectedVersion + 1 },
        resourceType: 'workspace', resourceId: workspaceId,
        outbox: { type: 'workspace.archived', version: 1, payload: { workspaceId } },
      }
    })
  }
}

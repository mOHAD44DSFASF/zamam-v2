import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest, Permission } from '@zamam/authorization'
import {
  SCHEMA_VERSION,
  assertProjectDateRange,
  assertProjectStatusTransition,
  normalizeProjectCode,
  normalizeProjectName,
} from '@zamam/domain'
import {
  SERVER_TIMESTAMP,
  tenantDocumentPath,
  type AtomicStore,
  type AtomicTransaction,
  type PageQuery,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const versionSchema = z.number().int().positive()
const projectSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  name: z.string().min(2).max(160),
  code: z.string().min(2).max(32),
  departmentId: idSchema.optional(),
  managerUserId: idSchema,
  startsOn: z.string().optional(),
  dueOn: z.string().optional(),
  clientVisible: z.boolean().default(false),
}).strict()
const memberSchema = z.object({
  projectId: idSchema,
  principalId: idSchema,
  principalType: z.enum(['member', 'client']),
  access: z.enum(['viewer', 'contributor', 'manager']),
}).strict()
const financialSchema = z.object({
  projectId: idSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  budgetMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  billingModel: z.enum(['fixed', 'hourly', 'retainer', 'non_billable']),
  status: z.enum(['draft', 'approved', 'locked']),
  expectedVersion: z.number().int().min(0),
}).strict()

export interface ProjectAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface ProjectCommandMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface ProjectLifecyclePort {
  activeWorkspaceCount(organizationId: string, projectId: string): Promise<number>
  openTaskCount(organizationId: string, projectId: string): Promise<number>
}

const systemPath = (organizationId: string, collection: string, id: string) => {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(organizationId) || !/^[A-Za-z0-9_-]{2,128}$/.test(id)) throw new Error('INVALID_SYSTEM_RECORD_ID')
  return `v2Organizations/${organizationId}/${collection}/${id}`
}
const stableId = (prefix: string, value: string) => `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
const baseRecord = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const readOwned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}
const numeric = (value: unknown) => {
  const result = Number(value)
  if (!Number.isInteger(result) || result < 0) throw new Error('INVALID_REFERENCE_COUNT')
  return result
}

export function buildProjectListQuery(input: {
  organizationId: string
  viewer: 'internal' | 'client'
  clientId?: string
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  idSchema.parse(input.organizationId)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  if (input.viewer === 'client' && !input.clientId) throw new Error('CLIENT_SCOPE_REQUIRED')
  if (input.clientId) idSchema.parse(input.clientId)
  return {
    organizationId: input.organizationId,
    entityKind: 'project',
    filters: [
      ...(input.clientId ? [{ field: 'clientId', operator: '==' as const, value: input.clientId }] : []),
      ...(input.viewer === 'client' ? [{ field: 'clientVisible', operator: '==' as const, value: true }] : []),
    ],
    orderBy: [{ field: 'updatedAt', direction: 'desc' }],
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class ProjectService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: ProjectAuthorizationGate,
    private readonly lifecycle: ProjectLifecyclePort,
    audit?: AuditCommandService,
  ) {
    this.audit = audit ?? new AuditCommandService(store)
  }

  private async authorized(metadata: ProjectCommandMetadata, permission: Permission, projectId?: string, clientId?: string) {
    await this.authorization.require(metadata.principal, {
      permission,
      organizationId: metadata.organizationId,
      ...(projectId ? {
        resource: {
          type: 'project', id: projectId, organizationId: metadata.organizationId,
          projectId, ...(clientId ? { clientAccountId: clientId } : {}), visibility: 'internal',
        },
      } : {}),
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async create(metadata: ProjectCommandMetadata, rawInput: z.input<typeof projectSchema>) {
    const parsed = projectSchema.parse(rawInput)
    const input = {
      ...parsed,
      name: normalizeProjectName(parsed.name),
      code: normalizeProjectCode(parsed.code),
    }
    assertProjectDateRange(input.startsOn, input.dueOn)
    const context = await this.authorized(metadata, 'project.create', input.id, input.clientId)
    return this.audit.execute(context, async (transaction) => {
      const client = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'client', input.clientId), metadata.organizationId)
      if (client.status !== 'active') throw new Error('CLIENT_NOT_ACTIVE')
      if (input.departmentId) {
        const department = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'department', input.departmentId), metadata.organizationId)
        if (department.status !== 'active') throw new Error('DEPARTMENT_NOT_ACTIVE')
      }
      const manager = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'employment_profile', input.managerUserId), metadata.organizationId)
      if (manager.status !== 'active') throw new Error('PROJECT_MANAGER_NOT_ACTIVE')
      const path = tenantDocumentPath(metadata.organizationId, 'project', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      const uniquePath = systemPath(metadata.organizationId, '_uniqueProjectCodes', stableId('project', input.code))
      if ((await transaction.get(uniquePath))?.active === true) throw new Error('PROJECT_CODE_ALREADY_EXISTS')
      transaction.create(path, { ...baseRecord(metadata.organizationId), ...input, status: 'draft' })
      transaction.create(uniquePath, { ...baseRecord(metadata.organizationId), active: true, projectId: input.id, normalizedCode: input.code })
      const countPath = systemPath(metadata.organizationId, '_clientActiveProjectCounts', input.clientId)
      const counter = await transaction.get(countPath)
      const value = numeric(counter?.value ?? 0) + 1
      if (counter) transaction.update(countPath, { value, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(countPath, { ...baseRecord(metadata.organizationId), value })
      return {
        result: { projectId: input.id, version: 1, status: 'draft' as const },
        resourceType: 'project', resourceId: input.id,
        outbox: { type: 'project.created', version: 1, payload: { projectId: input.id, clientId: input.clientId } },
      }
    })
  }

  async transition(metadata: ProjectCommandMetadata, projectId: string, expectedVersion: number, targetStatus: 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled') {
    idSchema.parse(projectId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'project.manage', projectId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'project', projectId)
      const project = await readOwned(transaction, path, metadata.organizationId)
      if (project.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      assertProjectStatusTransition(String(project.status), targetStatus)
      const version = expectedVersion + 1
      transaction.update(path, { status: targetStatus, version, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { projectId, version, status: targetStatus },
        resourceType: 'project', resourceId: projectId,
        outbox: { type: 'project.status_changed', version: 1, payload: { projectId, status: targetStatus } },
      }
    })
  }

  async reopen(metadata: ProjectCommandMetadata, projectId: string, expectedVersion: number, reason: string) {
    idSchema.parse(projectId)
    versionSchema.parse(expectedVersion)
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 10 || normalizedReason.length > 500) throw new Error('INVALID_REOPEN_REASON')
    const context = await this.authorized(metadata, 'project.reopen', projectId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'project', projectId)
      const project = await readOwned(transaction, path, metadata.organizationId)
      if (project.status !== 'completed') throw new Error('PROJECT_NOT_COMPLETED')
      if (project.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = expectedVersion + 1
      transaction.update(path, {
        status: 'active', reopenedAt: SERVER_TIMESTAMP, reopenedBy: metadata.principal.userId,
        reopenReason: normalizedReason, version, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { projectId, version, status: 'active' as const },
        resourceType: 'project', resourceId: projectId,
        outbox: { type: 'project.reopened', version: 1, payload: { projectId } },
      }
    })
  }

  async setClientVisibility(metadata: ProjectCommandMetadata, projectId: string, expectedVersion: number, clientVisible: boolean) {
    idSchema.parse(projectId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'project.manage', projectId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'project', projectId)
      const project = await readOwned(transaction, path, metadata.organizationId)
      if (['archived', 'cancelled'].includes(String(project.status))) throw new Error('PROJECT_VISIBILITY_LOCKED')
      if (project.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = expectedVersion + 1
      transaction.update(path, { clientVisible, version, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { projectId, version, clientVisible },
        resourceType: 'project', resourceId: projectId,
        outbox: { type: 'project.client_visibility_changed', version: 1, payload: { projectId, clientVisible } },
      }
    })
  }

  async addMember(metadata: ProjectCommandMetadata, rawInput: z.input<typeof memberSchema>) {
    const input = memberSchema.parse(rawInput)
    const context = await this.authorized(metadata, 'project.member.manage', input.projectId)
    return this.audit.execute(context, async (transaction) => {
      const project = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'project', input.projectId), metadata.organizationId)
      if (['archived', 'cancelled'].includes(String(project.status))) throw new Error('PROJECT_NOT_MEMBERSHIP_ACTIVE')
      let userId = input.principalId
      let contactId: string | undefined
      if (input.principalType === 'member') {
        const employment = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'employment_profile', input.principalId), metadata.organizationId)
        if (employment.status !== 'active') throw new Error('PROJECT_MEMBER_NOT_ACTIVE')
      } else {
        const contact = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'client_contact', input.principalId), metadata.organizationId)
        if (contact.clientId !== project.clientId || contact.portalStatus !== 'active' || typeof contact.userId !== 'string') {
          throw new Error('CLIENT_PROJECT_MEMBER_NOT_ELIGIBLE')
        }
        if (input.access !== 'viewer') throw new Error('CLIENT_PROJECT_ACCESS_EXCESSIVE')
        userId = contact.userId
        contactId = input.principalId
      }
      const memberId = stableId('member', `${input.projectId}:${input.principalType}:${userId}`)
      const path = tenantDocumentPath(metadata.organizationId, 'project_member', memberId)
      const existing = await transaction.get(path)
      if (existing?.status === 'active') throw new Error('PROJECT_MEMBERSHIP_ALREADY_ACTIVE')
      const record = {
        projectId: input.projectId,
        userId,
        principalType: input.principalType,
        access: input.principalType === 'client' ? 'viewer' as const : input.access,
        status: 'active',
        ...(contactId ? { contactId } : {}),
      }
      if (existing) transaction.update(path, { ...record, version: numeric(existing.version) + 1, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(path, { ...baseRecord(metadata.organizationId), ...record })
      return {
        result: { memberId, version: existing ? numeric(existing.version) + 1 : 1 },
        resourceType: 'project_member', resourceId: memberId,
        outbox: { type: 'project.member_added', version: 1, payload: { projectId: input.projectId, memberId, principalType: input.principalType } },
      }
    })
  }

  async updateFinancials(metadata: ProjectCommandMetadata, rawInput: z.input<typeof financialSchema>) {
    const input = financialSchema.parse(rawInput)
    const context = await this.authorized(metadata, 'project.financial.manage', input.projectId)
    return this.audit.execute(context, async (transaction) => {
      const project = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'project', input.projectId), metadata.organizationId)
      if (project.status === 'archived') throw new Error('PROJECT_ARCHIVED')
      const path = tenantDocumentPath(metadata.organizationId, 'project_financials', input.projectId)
      const existing = await transaction.get(path)
      if (!existing && input.expectedVersion !== 0) throw new Error('VERSION_CONFLICT')
      if (existing && existing.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT')
      if (existing?.status === 'locked') throw new Error('PROJECT_FINANCIALS_LOCKED')
      const version = input.expectedVersion + 1
      const values = {
        projectId: input.projectId, currency: input.currency, budgetMinor: input.budgetMinor,
        billingModel: input.billingModel, status: input.status,
      }
      if (existing) transaction.update(path, { ...values, version, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(path, { ...baseRecord(metadata.organizationId), ...values })
      return {
        result: { projectId: input.projectId, version },
        resourceType: 'project_financials', resourceId: input.projectId,
        outbox: { type: 'project.financials_updated', version: 1, payload: { projectId: input.projectId } },
      }
    })
  }

  async archive(metadata: ProjectCommandMetadata, projectId: string, expectedVersion: number) {
    idSchema.parse(projectId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'project.archive', projectId)
    const [workspaces, tasks] = await Promise.all([
      this.lifecycle.activeWorkspaceCount(metadata.organizationId, projectId),
      this.lifecycle.openTaskCount(metadata.organizationId, projectId),
    ])
    if (workspaces > 0 || tasks > 0) throw new Error('PROJECT_HAS_ACTIVE_WORK')
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'project', projectId)
      const project = await readOwned(transaction, path, metadata.organizationId)
      if (project.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      assertProjectStatusTransition(String(project.status), 'archived')
      const version = expectedVersion + 1
      transaction.update(path, { status: 'archived', archivedAt: SERVER_TIMESTAMP, version, updatedAt: SERVER_TIMESTAMP })
      const codePath = systemPath(metadata.organizationId, '_uniqueProjectCodes', stableId('project', String(project.code)))
      const code = await transaction.get(codePath)
      if (code) transaction.update(codePath, { active: false, updatedAt: SERVER_TIMESTAMP })
      const countPath = systemPath(metadata.organizationId, '_clientActiveProjectCounts', String(project.clientId))
      const counter = await transaction.get(countPath)
      if (counter) transaction.update(countPath, { value: Math.max(0, numeric(counter.value) - 1), updatedAt: SERVER_TIMESTAMP })
      return {
        result: { projectId, version, status: 'archived' as const },
        resourceType: 'project', resourceId: projectId,
        outbox: { type: 'project.archived', version: 1, payload: { projectId } },
      }
    })
  }
}

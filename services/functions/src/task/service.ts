import type { AuthorizationPrincipal, AuthorizationRequest, Permission } from '@zamam/authorization'
import {
  SCHEMA_VERSION, TERMINAL_TASK_STATUSES, assertTaskDueAt, assertTaskStatusTransition,
  normalizeTaskDescription, normalizeTaskTitle, type TaskStatus,
} from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type AtomicTransaction } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const version = z.number().int().positive()
const createTaskSchema = z.object({
  id, projectId: id, workspaceId: id.optional(), parentTaskId: id.optional(),
  title: z.string(), description: z.string().default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueAt: z.string().optional(), clientVisible: z.boolean().default(false),
}).strict()
const updateTaskSchema = z.object({
  taskId: id, expectedVersion: version,
  title: z.string().optional(), description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueAt: z.string().nullable().optional(), clientVisible: z.boolean().optional(),
}).strict()
const assignmentSchema = z.object({
  id, taskId: id, userId: id.optional(), teamId: id.optional(),
  assignmentRole: z.enum(['responsible', 'contributor']),
}).strict().refine((value) => Number(Boolean(value.userId)) + Number(Boolean(value.teamId)) === 1, 'ASSIGNMENT_PRINCIPAL_REQUIRED')

export interface TaskAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface TaskCommandMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface TaskReferencePort {
  activeWorkflowInstanceCount(organizationId: string, taskId: string): Promise<number>
}

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
const assertExpected = (record: Readonly<Record<string, unknown>>, expectedVersion: number) => {
  if (record.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
}

export class TaskService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: TaskAuthorizationGate,
    private readonly references: TaskReferencePort,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  private async authorized(metadata: TaskCommandMetadata, permission: Permission, taskId?: string) {
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId,
      ...(taskId ? { resource: {
        type: 'task', id: taskId, organizationId: metadata.organizationId,
        ownerUserId: metadata.principal.userId, visibility: 'internal',
      } } : {}),
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async create(metadata: TaskCommandMetadata, raw: z.input<typeof createTaskSchema>) {
    const parsed = createTaskSchema.parse(raw)
    const input = {
      ...parsed, title: normalizeTaskTitle(parsed.title),
      description: normalizeTaskDescription(parsed.description),
    }
    assertTaskDueAt(input.dueAt)
    const context = await this.authorized(metadata, 'task.create', input.id)
    return this.audit.execute(context, async (transaction) => {
      const project = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'project', input.projectId), metadata.organizationId)
      if (!['planned', 'active', 'on_hold'].includes(String(project.status))) throw new Error('TASK_PROJECT_NOT_ACTIVE')
      if (input.workspaceId) {
        const workspace = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workspace', input.workspaceId), metadata.organizationId)
        if (workspace.status !== 'active' || (workspace.projectId && workspace.projectId !== input.projectId)) throw new Error('TASK_WORKSPACE_SCOPE_CONFLICT')
      }
      if (input.parentTaskId) {
        const parent = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', input.parentTaskId), metadata.organizationId)
        if (parent.projectId !== input.projectId || TERMINAL_TASK_STATUSES.has(parent.status as TaskStatus)) throw new Error('TASK_PARENT_SCOPE_CONFLICT')
      }
      const path = tenantDocumentPath(metadata.organizationId, 'task', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, { ...base(metadata.organizationId), ...input, createdBy: metadata.principal.userId, status: 'draft' })
      return {
        result: { taskId: input.id, version: 1, status: 'draft' as const },
        resourceType: 'task', resourceId: input.id,
        outbox: { type: 'task.created', version: 1, payload: { taskId: input.id, projectId: input.projectId } },
      }
    })
  }

  async update(metadata: TaskCommandMetadata, raw: z.input<typeof updateTaskSchema>) {
    const input = updateTaskSchema.parse(raw)
    if (input.dueAt) assertTaskDueAt(input.dueAt)
    const context = await this.authorized(metadata, 'task.update', input.taskId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'task', input.taskId)
      const task = await owned(transaction, path, metadata.organizationId)
      assertExpected(task, input.expectedVersion)
      if (TERMINAL_TASK_STATUSES.has(task.status as TaskStatus)) throw new Error('TASK_TERMINAL_IMMUTABLE')
      const patch = {
        ...(input.title !== undefined ? { title: normalizeTaskTitle(input.title) } : {}),
        ...(input.description !== undefined ? { description: normalizeTaskDescription(input.description) } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(input.clientVisible !== undefined ? { clientVisible: input.clientVisible } : {}),
        version: input.expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      }
      transaction.update(path, patch)
      return {
        result: { taskId: input.taskId, version: input.expectedVersion + 1 },
        resourceType: 'task', resourceId: input.taskId,
        outbox: { type: 'task.updated', version: 1, payload: { taskId: input.taskId } },
      }
    })
  }

  async transition(metadata: TaskCommandMetadata, taskId: string, expectedVersion: number, targetStatus: TaskStatus, reason?: string) {
    id.parse(taskId); version.parse(expectedVersion)
    const context = await this.authorized(metadata, 'task.transition', taskId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'task', taskId)
      const task = await owned(transaction, path, metadata.organizationId)
      assertExpected(task, expectedVersion)
      assertTaskStatusTransition(task.status as TaskStatus, targetStatus)
      if (targetStatus === 'blocked' && (!reason || reason.trim().length < 3)) throw new Error('TASK_BLOCK_REASON_REQUIRED')
      const nextVersion = expectedVersion + 1
      transaction.update(path, {
        status: targetStatus, version: nextVersion, updatedAt: SERVER_TIMESTAMP,
        ...(targetStatus === 'completed' ? { completedAt: SERVER_TIMESTAMP } : {}),
        ...(targetStatus === 'blocked' ? { blockReason: reason!.trim() } : {}),
      })
      return {
        result: { taskId, version: nextVersion, status: targetStatus },
        resourceType: 'task', resourceId: taskId,
        outbox: { type: 'task.transitioned', version: 1, payload: { taskId, from: task.status, to: targetStatus } },
      }
    })
  }

  async reopen(metadata: TaskCommandMetadata, taskId: string, expectedVersion: number, reason: string) {
    id.parse(taskId); version.parse(expectedVersion)
    const normalized = reason.trim()
    if (normalized.length < 10 || normalized.length > 500) throw new Error('INVALID_REOPEN_REASON')
    const context = await this.authorized(metadata, 'task.reopen', taskId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'task', taskId)
      const task = await owned(transaction, path, metadata.organizationId)
      assertExpected(task, expectedVersion)
      if (task.status !== 'completed') throw new Error('TASK_NOT_COMPLETED')
      transaction.update(path, {
        status: 'ready', completedAt: null, reopenedAt: SERVER_TIMESTAMP, reopenedBy: metadata.principal.userId,
        reopenReason: normalized, version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { taskId, version: expectedVersion + 1, status: 'ready' as const },
        resourceType: 'task', resourceId: taskId,
        outbox: { type: 'task.reopened', version: 1, payload: { taskId } },
      }
    })
  }

  async addSubtask(metadata: TaskCommandMetadata, input: { id: string; taskId: string; title: string; assigneeUserId?: string }) {
    id.parse(input.id); id.parse(input.taskId)
    const context = await this.authorized(metadata, 'subtask.manage', input.taskId)
    return this.audit.execute(context, async (transaction) => {
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', input.taskId), metadata.organizationId)
      if (TERMINAL_TASK_STATUSES.has(task.status as TaskStatus)) throw new Error('TASK_TERMINAL_IMMUTABLE')
      if (input.assigneeUserId) {
        id.parse(input.assigneeUserId)
        const employment = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'employment_profile', input.assigneeUserId), metadata.organizationId)
        if (employment.status !== 'active') throw new Error('ASSIGNEE_NOT_ACTIVE')
      }
      const path = tenantDocumentPath(metadata.organizationId, 'subtask', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, { ...base(metadata.organizationId), taskId: input.taskId, title: normalizeTaskTitle(input.title), status: 'ready', ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}) })
      return {
        result: { subtaskId: input.id, version: 1 },
        resourceType: 'subtask', resourceId: input.id,
        outbox: { type: 'subtask.created', version: 1, payload: { taskId: input.taskId, subtaskId: input.id } },
      }
    })
  }

  async createChecklist(metadata: TaskCommandMetadata, input: { id: string; taskId: string; title: string; required: boolean; items: readonly { id: string; text: string; required: boolean }[] }) {
    id.parse(input.id); id.parse(input.taskId)
    if (input.items.length > 100) throw new Error('CHECKLIST_ITEM_LIMIT_EXCEEDED')
    const context = await this.authorized(metadata, 'checklist.update', input.taskId)
    return this.audit.execute(context, async (transaction) => {
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', input.taskId), metadata.organizationId)
      if (TERMINAL_TASK_STATUSES.has(task.status as TaskStatus)) throw new Error('TASK_TERMINAL_IMMUTABLE')
      transaction.create(tenantDocumentPath(metadata.organizationId, 'checklist', input.id), {
        ...base(metadata.organizationId), taskId: input.taskId, title: normalizeTaskTitle(input.title), required: input.required,
      })
      for (const item of input.items) {
        id.parse(item.id)
        const text = item.text.trim()
        if (!text || text.length > 500) throw new Error('INVALID_CHECKLIST_ITEM')
        transaction.create(tenantDocumentPath(metadata.organizationId, 'checklist_item', item.id), {
          ...base(metadata.organizationId), checklistId: input.id, taskId: input.taskId,
          text, required: item.required, completed: false,
        })
      }
      return {
        result: { checklistId: input.id, itemCount: input.items.length },
        resourceType: 'checklist', resourceId: input.id,
        outbox: { type: 'checklist.created', version: 1, payload: { taskId: input.taskId, checklistId: input.id } },
      }
    })
  }

  async setChecklistItem(metadata: TaskCommandMetadata, itemId: string, expectedVersion: number, completed: boolean) {
    id.parse(itemId); version.parse(expectedVersion)
    const context = await this.authorized(metadata, 'checklist.update')
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'checklist_item', itemId)
      const item = await owned(transaction, path, metadata.organizationId)
      assertExpected(item, expectedVersion)
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', String(item.taskId)), metadata.organizationId)
      if (TERMINAL_TASK_STATUSES.has(task.status as TaskStatus)) throw new Error('TASK_TERMINAL_IMMUTABLE')
      transaction.update(path, {
        completed, completedBy: completed ? metadata.principal.userId : null,
        completedAt: completed ? SERVER_TIMESTAMP : null,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { itemId, version: expectedVersion + 1, completed },
        resourceType: 'checklist_item', resourceId: itemId,
        outbox: { type: 'checklist.item_updated', version: 1, payload: { taskId: item.taskId, itemId, completed } },
      }
    })
  }

  async assign(metadata: TaskCommandMetadata, raw: z.input<typeof assignmentSchema>) {
    const input = assignmentSchema.parse(raw)
    const context = await this.authorized(metadata, 'task.assign', input.taskId)
    return this.audit.execute(context, async (transaction) => {
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', input.taskId), metadata.organizationId)
      if (TERMINAL_TASK_STATUSES.has(task.status as TaskStatus)) throw new Error('TASK_TERMINAL_IMMUTABLE')
      if (input.userId) {
        const employment = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'employment_profile', input.userId), metadata.organizationId)
        if (employment.status !== 'active') throw new Error('ASSIGNEE_NOT_ACTIVE')
      }
      if (input.teamId) {
        const team = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'team', input.teamId), metadata.organizationId)
        if (team.status !== 'active') throw new Error('ASSIGNEE_TEAM_NOT_ACTIVE')
      }
      const path = tenantDocumentPath(metadata.organizationId, 'task_assignment', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, { ...base(metadata.organizationId), ...input, assignedBy: metadata.principal.userId, status: 'pending' })
      return {
        result: { assignmentId: input.id, version: 1, status: 'pending' as const },
        resourceType: 'task_assignment', resourceId: input.id,
        outbox: { type: 'task.assigned', version: 1, payload: { taskId: input.taskId, assignmentId: input.id } },
      }
    })
  }

  async respondToAssignment(metadata: TaskCommandMetadata, assignmentId: string, expectedVersion: number, response: 'accepted' | 'declined') {
    id.parse(assignmentId); version.parse(expectedVersion)
    const context = await this.authorized(metadata, 'task.claim')
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'task_assignment', assignmentId)
      const assignment = await owned(transaction, path, metadata.organizationId)
      assertExpected(assignment, expectedVersion)
      if (assignment.userId !== metadata.principal.userId || assignment.status !== 'pending') throw new Error('ASSIGNMENT_RESPONSE_DENIED')
      transaction.update(path, {
        status: response, ...(response === 'accepted' ? { acceptedAt: SERVER_TIMESTAMP } : { declinedAt: SERVER_TIMESTAMP }),
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { assignmentId, version: expectedVersion + 1, status: response },
        resourceType: 'task_assignment', resourceId: assignmentId,
        outbox: { type: `task.assignment_${response}`, version: 1, payload: { taskId: assignment.taskId, assignmentId } },
      }
    })
  }

  async archive(metadata: TaskCommandMetadata, taskId: string, expectedVersion: number) {
    id.parse(taskId); version.parse(expectedVersion)
    if (await this.references.activeWorkflowInstanceCount(metadata.organizationId, taskId) > 0) throw new Error('TASK_HAS_ACTIVE_WORKFLOW')
    const context = await this.authorized(metadata, 'task.archive', taskId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'task', taskId)
      const task = await owned(transaction, path, metadata.organizationId)
      assertExpected(task, expectedVersion)
      assertTaskStatusTransition(task.status as TaskStatus, 'archived')
      transaction.update(path, {
        status: 'archived', archivedAt: SERVER_TIMESTAMP,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { taskId, version: expectedVersion + 1, status: 'archived' as const },
        resourceType: 'task', resourceId: taskId,
        outbox: { type: 'task.archived', version: 1, payload: { taskId } },
      }
    })
  }
}

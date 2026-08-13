import type { AuthorizationPrincipal, AuthorizationRequest, Permission } from '@zamam/authorization'
import {
  SCHEMA_VERSION, TERMINAL_TASK_STATUSES, assertDriveLink, assertSendBackTarget, assertStepStatusTransition,
  assertStepAssigneeInput, assertStepsInput, assertTaskDueAt, assertTaskStatusTransition, normalizeReassignmentReason,
  normalizeSendBackReason, normalizeStepName, normalizeTaskDescription, normalizeTaskTitle, normalizeWaitingReason,
  type TaskStatus, type TaskStepInput, type TaskStepStatus,
} from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type AtomicTransaction } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const version = z.number().int().positive()
const stepInputSchema = z.object({
  name: z.string(),
  assigneeType: z.enum(['person', 'department']),
  assigneeUserId: id.optional(),
  assigneeDepartmentId: id.optional(),
  driveLink: z.string().optional(),
  dueAt: z.string().optional(),
}).strict()
const setStepDueDateSchema = z.object({
  taskId: id, stepOrder: z.number().int().min(0), expectedVersion: version, dueAt: z.string().nullable(),
}).strict()
const createTaskSchema = z.object({
  id, projectId: id.optional(), workspaceId: id.optional(), parentTaskId: id.optional(), departmentId: id.optional(),
  title: z.string(), description: z.string().default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueAt: z.string().optional(), clientVisible: z.boolean().default(false), driveLink: z.string().optional(),
  steps: z.array(stepInputSchema).min(1),
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
const sendBackSchema = z.object({
  taskId: id, expectedVersion: version, targetStepOrder: z.number().int().min(0), reason: z.string(),
}).strict()
const reassignStepSchema = z.object({
  taskId: id, expectedVersion: version, assigneeType: z.enum(['person', 'department']),
  assigneeUserId: id.optional(), assigneeDepartmentId: id.optional(), reason: z.string().optional(),
}).strict()
const stepWaitingSchema = z.object({ taskId: id, expectedVersion: version, reason: z.string() }).strict()
const resumeStepSchema = z.object({ taskId: id, expectedVersion: version }).strict()

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
/** Resolves a department's active members — needed synchronously at task-creation time (not deferrable to
 * async notification projection) so every department-assigned step's members get a `task_assignment` row
 * the moment the task exists, satisfying the "past/current/future step assignee can see the task" rule. */
export interface TaskDepartmentMembersPort {
  activeMembers(organizationId: string, departmentId: string): Promise<readonly string[]>
}
/** Role-assignment queries are deliberately separate from the generic authorization engine: it cannot
 * represent the reassign rule's OR between task creator and the current holder's department scope. */
export interface TaskReassignmentRolePort {
  hasActiveOrganizationManagerOrOwner(organizationId: string, userId: string): Promise<boolean>
  hasActiveDepartmentLead(organizationId: string, userId: string, departmentId: string): Promise<boolean>
}
const noReassignmentRoles: TaskReassignmentRolePort = {
  hasActiveOrganizationManagerOrOwner: async () => false,
  hasActiveDepartmentLead: async () => false,
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
const stepPath = (organizationId: string, taskId: string, order: number) =>
  tenantDocumentPath(organizationId, 'task_step', `${taskId}-step-${order}`)
const assignmentPath = (organizationId: string, taskId: string, userId: string) =>
  tenantDocumentPath(organizationId, 'task_assignment', `${taskId}-assign-${userId}`)
const stepEventId = (taskId: string, order: number, sequence: number) => `${taskId}-step-${order}-event-${sequence}`

/** Is `principal` allowed to act as the holder of `step` right now? Person steps are an exact userId
 * match; department steps require the caller's own primary department to match the step's — no separate
 * "claim" workflow, any active member of the department may act (see docs in the product request). */
const stepEligibility = (
  principal: AuthorizationPrincipal, step: Readonly<Record<string, unknown>>, callerEmployment: Readonly<Record<string, unknown>> | null,
) => step.assigneeType === 'person'
  ? step.assigneeUserId === principal.userId
  : callerEmployment?.primaryDepartmentId === step.assigneeDepartmentId

export class TaskService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: TaskAuthorizationGate,
    private readonly references: TaskReferencePort,
    private readonly departments: TaskDepartmentMembersPort,
    audit?: AuditCommandService,
    private readonly reassignmentRoles: TaskReassignmentRolePort = noReassignmentRoles,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  private async authorized(metadata: TaskCommandMetadata, permission: Permission, taskId?: string, extra?: {
    departmentId?: string; assigneeUserIds?: readonly string[]
  }) {
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId,
      ...(taskId ? { resource: {
        type: 'task', id: taskId, organizationId: metadata.organizationId,
        ownerUserId: metadata.principal.userId, visibility: 'internal',
        ...(extra?.departmentId ? { departmentId: extra.departmentId } : {}),
        ...(extra?.assigneeUserIds ? { assigneeUserIds: extra.assigneeUserIds } : {}),
      } } : {}),
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async create(metadata: TaskCommandMetadata, raw: z.input<typeof createTaskSchema>) {
    const parsed = createTaskSchema.parse(raw)
    const steps: TaskStepInput[] = parsed.steps.map((step) => ({
      name: step.name, assigneeType: step.assigneeType,
      ...(step.assigneeUserId ? { assigneeUserId: step.assigneeUserId } : {}),
      ...(step.assigneeDepartmentId ? { assigneeDepartmentId: step.assigneeDepartmentId } : {}),
      ...(step.driveLink ? { driveLink: step.driveLink } : {}),
      ...(step.dueAt ? { dueAt: step.dueAt } : {}),
    }))
    const input = {
      ...parsed, title: normalizeTaskTitle(parsed.title),
      description: normalizeTaskDescription(parsed.description), steps,
    }
    assertTaskDueAt(input.dueAt)
    assertDriveLink(input.driveLink)
    assertStepsInput(input.steps)
    // A Department Lead's task.create is scoped to their own department (see engine.ts scopeMatches() and
    // the Manager/DepartmentLead role-assignment scopes set up in EmployeeService.invite()) — a Manager or
    // Owner's organization-scoped assignment matches regardless of departmentId.
    const context = await this.authorized(metadata, 'task.create', input.id, {
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    })
    // Resolve department-assigned steps' active members BEFORE the transaction — Firestore transactions in
    // this codebase only do direct-path get()s, never queries (see ProjectLifecyclePort/WorkloadSourcePort
    // for the same pre-transaction-resolution pattern).
    const departmentIds = [...new Set(
      input.steps.filter((step): step is TaskStepInput & { assigneeDepartmentId: string } => step.assigneeType === 'department' && Boolean(step.assigneeDepartmentId))
        .map((step) => step.assigneeDepartmentId),
    )]
    const departmentMembers = new Map<string, readonly string[]>()
    for (const departmentId of departmentIds) {
      departmentMembers.set(departmentId, await this.departments.activeMembers(metadata.organizationId, departmentId))
    }
    return this.audit.execute(context, async (transaction) => {
      // Read phase — all get()s before any write (Firestore transaction rule).
      if (input.projectId) {
        const project = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'project', input.projectId), metadata.organizationId)
        if (!['planned', 'active', 'on_hold'].includes(String(project.status))) throw new Error('TASK_PROJECT_NOT_ACTIVE')
      }
      if (input.workspaceId) {
        if (!input.projectId) throw new Error('TASK_WORKSPACE_REQUIRES_PROJECT')
        const workspace = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workspace', input.workspaceId), metadata.organizationId)
        if (workspace.status !== 'active' || (workspace.projectId && workspace.projectId !== input.projectId)) throw new Error('TASK_WORKSPACE_SCOPE_CONFLICT')
      }
      if (input.parentTaskId) {
        const parent = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', input.parentTaskId), metadata.organizationId)
        if ((input.projectId && parent.projectId !== input.projectId) || TERMINAL_TASK_STATUSES.has(parent.status as TaskStatus)) throw new Error('TASK_PARENT_SCOPE_CONFLICT')
      }
      if (input.departmentId) {
        const department = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'department', input.departmentId), metadata.organizationId)
        if (department.status !== 'active') throw new Error('TASK_DEPARTMENT_NOT_ACTIVE')
      }
      const employmentCache = new Map<string, Readonly<Record<string, unknown>>>()
      for (const step of input.steps) {
        if (step.assigneeType !== 'person' || employmentCache.has(step.assigneeUserId!)) continue
        const employment = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'employment_profile', step.assigneeUserId!), metadata.organizationId)
        if (employment.status !== 'active') throw new Error('STEP_ASSIGNEE_NOT_ACTIVE')
        employmentCache.set(step.assigneeUserId!, employment)
      }
      const path = tenantDocumentPath(metadata.organizationId, 'task', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      // Write phase.
      const { steps, ...taskFields } = input
      const firstStep = steps[0]!
      transaction.create(path, {
        ...base(metadata.organizationId), ...taskFields, createdBy: metadata.principal.userId,
        status: 'in_progress', currentStepOrder: 0, stepCount: steps.length,
        // Denormalized current-step summary — kept in sync at every step transition below and in
        // completeCurrentStep()/sendBackStep() — lets dashboards (Area 3) and the WhatsApp reminder
        // button (Area 5) read "what's the current step, who holds it, is it stalled" straight off the
        // task doc instead of an extra per-task step read.
        currentStepName: normalizeStepName(firstStep.name), currentStepAssigneeType: firstStep.assigneeType,
        ...(firstStep.assigneeUserId ? { currentStepAssigneeUserId: firstStep.assigneeUserId } : {}),
        ...(firstStep.assigneeDepartmentId ? { currentStepAssigneeDepartmentId: firstStep.assigneeDepartmentId } : {}),
        currentStepStatus: 'in_progress' as const, currentStepWaitingReason: null,
        currentStepDueAt: firstStep.dueAt ?? null, currentStepEnteredAt: SERVER_TIMESTAMP,
      })
      const assignedUserIds = new Set<string>()
      let firstStepAssigneeUserIds: readonly string[] = []
      steps.forEach((step, order) => {
        const isCurrent = order === 0
        transaction.create(stepPath(metadata.organizationId, input.id, order), {
          ...base(metadata.organizationId), taskId: input.id, order, name: normalizeStepName(step.name),
          assigneeType: step.assigneeType,
          ...(step.assigneeUserId ? { assigneeUserId: step.assigneeUserId } : {}),
          ...(step.assigneeDepartmentId ? { assigneeDepartmentId: step.assigneeDepartmentId } : {}),
          ...(step.driveLink ? { driveLink: step.driveLink } : {}),
          ...(step.dueAt ? { dueAt: step.dueAt } : {}),
          status: (isCurrent ? 'in_progress' : 'pending') satisfies TaskStepStatus,
        })
        const assigneeUserIds = step.assigneeType === 'person'
          ? [step.assigneeUserId!]
          : departmentMembers.get(step.assigneeDepartmentId!) ?? []
        if (isCurrent) firstStepAssigneeUserIds = assigneeUserIds
        for (const userId of assigneeUserIds) {
          if (assignedUserIds.has(userId)) continue
          assignedUserIds.add(userId)
          transaction.create(assignmentPath(metadata.organizationId, input.id, userId), {
            ...base(metadata.organizationId), taskId: input.id, userId, assignmentRole: 'responsible' as const,
            assignedBy: metadata.principal.userId, status: 'accepted',
          })
        }
      })
      return {
        result: { taskId: input.id, version: 1, status: 'in_progress' as const, stepCount: steps.length },
        resourceType: 'task', resourceId: input.id,
        outbox: {
          type: 'task.created', version: 1,
          payload: { taskId: input.id, ...(input.projectId ? { projectId: input.projectId } : {}), assigneeUserIds: firstStepAssigneeUserIds },
        },
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

  /** Pre-transaction read used by both completeCurrentStep and sendBackStep to (a) build the resource
   * context an authorization check needs before it can decide, and (b) hand the audited transaction a
   * consistent view it re-verifies from scratch — same split WorkflowExecutionService.transition() uses. */
  private async readCurrentStepSnapshot(organizationId: string, taskId: string, principalUserId: string) {
    return this.store.runTransaction(async (transaction) => {
      const task = await owned(transaction, tenantDocumentPath(organizationId, 'task', taskId), organizationId)
      const step = await owned(transaction, stepPath(organizationId, taskId, Number(task.currentStepOrder)), organizationId)
      const callerEmployment = await transaction.get(tenantDocumentPath(organizationId, 'employment_profile', principalUserId))
      const currentHolderEmployment = step.assigneeType === 'person' && typeof step.assigneeUserId === 'string'
        ? await transaction.get(tenantDocumentPath(organizationId, 'employment_profile', step.assigneeUserId))
        : null
      return { task, step, callerEmployment, currentHolderEmployment }
    })
  }

  async completeCurrentStep(metadata: TaskCommandMetadata, taskId: string, expectedVersion: number) {
    id.parse(taskId); version.parse(expectedVersion)
    const snapshot = await this.readCurrentStepSnapshot(metadata.organizationId, taskId, metadata.principal.userId)
    const eligible = stepEligibility(metadata.principal, snapshot.step, snapshot.callerEmployment)
    const context = await this.authorized(metadata, 'task.transition', taskId, {
      assigneeUserIds: eligible ? [metadata.principal.userId] : [],
    })
    return this.audit.execute(context, async (transaction) => {
      const taskPath = tenantDocumentPath(metadata.organizationId, 'task', taskId)
      const task = await owned(transaction, taskPath, metadata.organizationId)
      assertExpected(task, expectedVersion)
      const currentOrder = Number(task.currentStepOrder)
      const currentStepPath = stepPath(metadata.organizationId, taskId, currentOrder)
      const currentStep = await owned(transaction, currentStepPath, metadata.organizationId)
      if (!stepEligibility(metadata.principal, currentStep, snapshot.callerEmployment)) throw new Error('STEP_HOLDER_REQUIRED')
      assertStepStatusTransition(currentStep.status as TaskStepStatus, 'done')
      const stepCount = Number(task.stepCount)
      const isLastStep = currentOrder === stepCount - 1
      const nextStep = isLastStep ? null : await owned(transaction, stepPath(metadata.organizationId, taskId, currentOrder + 1), metadata.organizationId)
      const nextVersion = Number(task.version) + 1
      // Write phase.
      transaction.update(currentStepPath, {
        status: 'done' as const, version: Number(currentStep.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.create(tenantDocumentPath(metadata.organizationId, 'task_step_event', stepEventId(taskId, currentOrder, Number(task.version))), {
        ...base(metadata.organizationId), taskId, stepOrder: currentOrder, fromStatus: currentStep.status, toStatus: 'done',
        actorUserId: metadata.principal.userId, occurredAt: SERVER_TIMESTAMP,
      })
      if (isLastStep) {
        transaction.update(taskPath, {
          status: 'completed', completedAt: SERVER_TIMESTAMP, version: nextVersion, updatedAt: SERVER_TIMESTAMP,
          currentStepDueAt: null, currentStepStatus: 'done' as const, currentStepWaitingReason: null,
        })
      } else {
        const nextPath = stepPath(metadata.organizationId, taskId, currentOrder + 1)
        transaction.update(nextPath, { status: 'in_progress' as const, version: Number(nextStep!.version) + 1, updatedAt: SERVER_TIMESTAMP })
        transaction.update(taskPath, {
          currentStepOrder: currentOrder + 1, version: nextVersion, updatedAt: SERVER_TIMESTAMP,
          currentStepName: String(nextStep!.name), currentStepAssigneeType: nextStep!.assigneeType,
          ...(nextStep!.assigneeUserId ? { currentStepAssigneeUserId: nextStep!.assigneeUserId } : { currentStepAssigneeUserId: null }),
          ...(nextStep!.assigneeDepartmentId ? { currentStepAssigneeDepartmentId: nextStep!.assigneeDepartmentId } : { currentStepAssigneeDepartmentId: null }),
          currentStepStatus: 'in_progress' as const, currentStepWaitingReason: null,
          currentStepDueAt: nextStep!.dueAt ?? null, currentStepEnteredAt: SERVER_TIMESTAMP,
        })
      }
      const nextAssignee = nextStep
        ? (nextStep.assigneeType === 'person'
          ? { assigneeUserId: String(nextStep.assigneeUserId) }
          : { assigneeDepartmentId: String(nextStep.assigneeDepartmentId) })
        : {}
      return {
        result: { taskId, version: nextVersion, currentStepOrder: isLastStep ? currentOrder : currentOrder + 1, taskStatus: isLastStep ? 'completed' as const : 'in_progress' as const },
        resourceType: 'task', resourceId: taskId,
        outbox: isLastStep
          ? { type: 'task.transitioned', version: 1, payload: { taskId, from: 'in_progress', to: 'completed' } }
          : { type: 'task.step_arrived', version: 1, payload: { taskId, stepOrder: currentOrder + 1, ...nextAssignee } },
      }
    })
  }

  async sendBackStep(metadata: TaskCommandMetadata, raw: z.input<typeof sendBackSchema>) {
    const input = sendBackSchema.parse(raw)
    const reason = normalizeSendBackReason(input.reason)
    const snapshot = await this.readCurrentStepSnapshot(metadata.organizationId, input.taskId, metadata.principal.userId)
    const eligible = stepEligibility(metadata.principal, snapshot.step, snapshot.callerEmployment)
    const context = await this.authorized(metadata, 'task.transition', input.taskId, {
      assigneeUserIds: eligible ? [metadata.principal.userId] : [],
    })
    return this.audit.execute(context, async (transaction) => {
      const taskPath = tenantDocumentPath(metadata.organizationId, 'task', input.taskId)
      const task = await owned(transaction, taskPath, metadata.organizationId)
      assertExpected(task, input.expectedVersion)
      const currentOrder = Number(task.currentStepOrder)
      assertSendBackTarget(currentOrder, input.targetStepOrder)
      const currentStepPath = stepPath(metadata.organizationId, input.taskId, currentOrder)
      const currentStep = await owned(transaction, currentStepPath, metadata.organizationId)
      if (!stepEligibility(metadata.principal, currentStep, snapshot.callerEmployment)) throw new Error('STEP_HOLDER_REQUIRED')
      assertStepStatusTransition(currentStep.status as TaskStepStatus, 'sent_back')
      const targetStepPath = stepPath(metadata.organizationId, input.taskId, input.targetStepOrder)
      const targetStep = await owned(transaction, targetStepPath, metadata.organizationId)
      // Read phase for every "in-between" step (target < order < current) — all get()s before any write.
      const betweenPaths = Array.from(
        { length: Math.max(0, currentOrder - input.targetStepOrder - 1) },
        (_, index) => stepPath(metadata.organizationId, input.taskId, input.targetStepOrder + 1 + index),
      )
      const betweenSteps = await Promise.all(betweenPaths.map((path) => owned(transaction, path, metadata.organizationId)))
      const nextVersion = Number(task.version) + 1
      // Write phase.
      transaction.update(currentStepPath, { status: 'sent_back' as const, version: Number(currentStep.version) + 1, updatedAt: SERVER_TIMESTAMP })
      transaction.update(targetStepPath, { status: 'in_progress' as const, version: Number(targetStep.version) + 1, updatedAt: SERVER_TIMESTAMP })
      betweenPaths.forEach((path, index) => {
        transaction.update(path, { status: 'pending' as const, version: Number(betweenSteps[index]!.version) + 1, updatedAt: SERVER_TIMESTAMP })
      })
      transaction.update(taskPath, {
        currentStepOrder: input.targetStepOrder, version: nextVersion, updatedAt: SERVER_TIMESTAMP,
        currentStepName: String(targetStep.name), currentStepAssigneeType: targetStep.assigneeType,
        ...(targetStep.assigneeUserId ? { currentStepAssigneeUserId: targetStep.assigneeUserId } : { currentStepAssigneeUserId: null }),
        ...(targetStep.assigneeDepartmentId ? { currentStepAssigneeDepartmentId: targetStep.assigneeDepartmentId } : { currentStepAssigneeDepartmentId: null }),
        currentStepStatus: 'in_progress' as const, currentStepWaitingReason: null,
        currentStepDueAt: targetStep.dueAt ?? null, currentStepEnteredAt: SERVER_TIMESTAMP,
      })
      transaction.create(tenantDocumentPath(metadata.organizationId, 'task_step_event', stepEventId(input.taskId, currentOrder, Number(task.version))), {
        ...base(metadata.organizationId), taskId: input.taskId, stepOrder: currentOrder, fromStatus: currentStep.status,
        toStatus: 'sent_back', actorUserId: metadata.principal.userId, reason, targetStepOrder: input.targetStepOrder,
        occurredAt: SERVER_TIMESTAMP,
      })
      const targetAssignee = targetStep.assigneeType === 'person'
        ? { assigneeUserId: String(targetStep.assigneeUserId) }
        : { assigneeDepartmentId: String(targetStep.assigneeDepartmentId) }
      return {
        result: { taskId: input.taskId, version: nextVersion, currentStepOrder: input.targetStepOrder },
        resourceType: 'task', resourceId: input.taskId,
        outbox: { type: 'task.step_sent_back', version: 1, payload: { taskId: input.taskId, stepOrder: input.targetStepOrder, reason, ...targetAssignee } },
      }
    })
  }

  /** Changes only the current step's holder. The ordinary authorization gate is a coarse pre-check only —
   * it needs a resource attached (taskId, and the step's current department when known) purely so a
   * 'self'-scoped grant (via the ownerUserId fallback every step action already relies on) or a
   * 'department'-scoped grant has something to match against at all; scopeMatches() treats every non-
   * organization scope as an automatic denial when no resource is given at all (see engine.ts). The
   * authoritative four-way rule (current holder OR task creator OR org Manager/Owner OR the current
   * holder's Department Lead) is still the explicit check below in the audited transaction — this
   * pre-check only has to be permissive enough not to reject a legitimate caller before reaching it. */
  async reassignStep(metadata: TaskCommandMetadata, raw: z.input<typeof reassignStepSchema>) {
    const input = reassignStepSchema.parse(raw)
    assertStepAssigneeInput({
      assigneeType: input.assigneeType,
      ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}),
      ...(input.assigneeDepartmentId ? { assigneeDepartmentId: input.assigneeDepartmentId } : {}),
    })
    const reason = normalizeReassignmentReason(input.reason)
    const snapshot = await this.readCurrentStepSnapshot(metadata.organizationId, input.taskId, metadata.principal.userId)
    const priorDepartmentId = snapshot.step.assigneeType === 'department'
      ? (typeof snapshot.step.assigneeDepartmentId === 'string' ? snapshot.step.assigneeDepartmentId : null)
      : (typeof snapshot.currentHolderEmployment?.primaryDepartmentId === 'string' ? snapshot.currentHolderEmployment.primaryDepartmentId : null)
    const context = await this.authorized(metadata, 'task.reassign', input.taskId, {
      ...(priorDepartmentId ? { departmentId: priorDepartmentId } : {}),
    })
    const [hasOrganizationRole, hasDepartmentLeadRole] = await Promise.all([
      this.reassignmentRoles.hasActiveOrganizationManagerOrOwner(metadata.organizationId, metadata.principal.userId),
      priorDepartmentId
        ? this.reassignmentRoles.hasActiveDepartmentLead(metadata.organizationId, metadata.principal.userId, priorDepartmentId)
        : Promise.resolve(false),
    ])
    // Notification projection expands one department field only. Resolve both the old and new department
    // here into an explicit recipient list, which also makes the reassignment's audience deterministic.
    const departmentIds = [...new Set([
      snapshot.step.assigneeType === 'department' && typeof snapshot.step.assigneeDepartmentId === 'string' ? snapshot.step.assigneeDepartmentId : null,
      input.assigneeType === 'department' ? input.assigneeDepartmentId ?? null : null,
    ].filter((value): value is string => Boolean(value)))]
    const membersByDepartment = new Map<string, readonly string[]>()
    for (const departmentId of departmentIds) {
      membersByDepartment.set(departmentId, await this.departments.activeMembers(metadata.organizationId, departmentId))
    }
    const newAssigneeUserIds = input.assigneeType === 'person'
      ? [input.assigneeUserId!]
      : membersByDepartment.get(input.assigneeDepartmentId!) ?? []
    const recipientUserIds = new Set<string>(newAssigneeUserIds)
    if (snapshot.step.assigneeType === 'person' && typeof snapshot.step.assigneeUserId === 'string') {
      recipientUserIds.add(snapshot.step.assigneeUserId)
    }
    if (snapshot.step.assigneeType === 'department' && typeof snapshot.step.assigneeDepartmentId === 'string') {
      for (const userId of membersByDepartment.get(snapshot.step.assigneeDepartmentId) ?? []) recipientUserIds.add(userId)
    }

    return this.audit.execute(context, async (transaction) => {
      const taskPath = tenantDocumentPath(metadata.organizationId, 'task', input.taskId)
      const task = await owned(transaction, taskPath, metadata.organizationId)
      assertExpected(task, input.expectedVersion)
      const currentOrder = Number(task.currentStepOrder)
      const currentStepPath = stepPath(metadata.organizationId, input.taskId, currentOrder)
      const currentStep = await owned(transaction, currentStepPath, metadata.organizationId)
      const callerEmployment = await transaction.get(tenantDocumentPath(metadata.organizationId, 'employment_profile', metadata.principal.userId))
      const currentHolderEmployment = currentStep.assigneeType === 'person' && typeof currentStep.assigneeUserId === 'string'
        ? await transaction.get(tenantDocumentPath(metadata.organizationId, 'employment_profile', currentStep.assigneeUserId))
        : null
      const newAssigneeEmployment = input.assigneeType === 'person'
        ? await owned(transaction, tenantDocumentPath(metadata.organizationId, 'employment_profile', input.assigneeUserId!), metadata.organizationId)
        : null
      const assignmentRows = await Promise.all(newAssigneeUserIds.map(async (userId) => ({
        userId, record: await transaction.get(assignmentPath(metadata.organizationId, input.taskId, userId)),
      })))
      const currentHolderDepartmentId = currentStep.assigneeType === 'department'
        ? (typeof currentStep.assigneeDepartmentId === 'string' ? currentStep.assigneeDepartmentId : null)
        : (typeof currentHolderEmployment?.primaryDepartmentId === 'string' ? currentHolderEmployment.primaryDepartmentId : null)
      const eligible = stepEligibility(metadata.principal, currentStep, callerEmployment)
        || task.createdBy === metadata.principal.userId
        || hasOrganizationRole
        || (Boolean(currentHolderDepartmentId) && hasDepartmentLeadRole)
      if (!eligible) throw new Error('REASSIGN_NOT_ELIGIBLE')
      if (newAssigneeEmployment && newAssigneeEmployment.status !== 'active') throw new Error('STEP_ASSIGNEE_NOT_ACTIVE')
      const nextVersion = Number(task.version) + 1
      // Write phase — no transaction.get() calls may occur below this point.
      transaction.update(currentStepPath, {
        assigneeType: input.assigneeType,
        assigneeUserId: input.assigneeType === 'person' ? input.assigneeUserId! : null,
        assigneeDepartmentId: input.assigneeType === 'department' ? input.assigneeDepartmentId! : null,
        version: Number(currentStep.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(taskPath, {
        version: nextVersion, updatedAt: SERVER_TIMESTAMP,
        currentStepAssigneeType: input.assigneeType,
        currentStepAssigneeUserId: input.assigneeType === 'person' ? input.assigneeUserId! : null,
        currentStepAssigneeDepartmentId: input.assigneeType === 'department' ? input.assigneeDepartmentId! : null,
        currentStepEnteredAt: SERVER_TIMESTAMP,
      })
      for (const assignment of assignmentRows) {
        if (assignment.record) continue
        transaction.create(assignmentPath(metadata.organizationId, input.taskId, assignment.userId), {
          ...base(metadata.organizationId), taskId: input.taskId, userId: assignment.userId,
          assignmentRole: 'responsible' as const, assignedBy: metadata.principal.userId, status: 'accepted',
        })
      }
      transaction.create(tenantDocumentPath(metadata.organizationId, 'task_step_event', stepEventId(input.taskId, currentOrder, Number(task.version))), {
        ...base(metadata.organizationId), taskId: input.taskId, stepOrder: currentOrder, eventType: 'reassigned',
        actorUserId: metadata.principal.userId,
        previousAssigneeType: currentStep.assigneeType,
        previousAssigneeUserId: currentStep.assigneeType === 'person' ? currentStep.assigneeUserId ?? null : null,
        previousAssigneeDepartmentId: currentStep.assigneeType === 'department' ? currentStep.assigneeDepartmentId ?? null : null,
        newAssigneeType: input.assigneeType,
        newAssigneeUserId: input.assigneeType === 'person' ? input.assigneeUserId! : null,
        newAssigneeDepartmentId: input.assigneeType === 'department' ? input.assigneeDepartmentId! : null,
        ...(reason ? { reason } : {}), occurredAt: SERVER_TIMESTAMP,
      })
      return {
        result: { taskId: input.taskId, version: nextVersion, currentStepOrder: currentOrder },
        resourceType: 'task', resourceId: input.taskId,
        outbox: {
          type: 'task.step_reassigned', version: 1,
          payload: {
            taskId: input.taskId, stepOrder: currentOrder, recipientUserIds: [...recipientUserIds],
            resourceType: 'task', resourceId: input.taskId,
            previousAssigneeType: currentStep.assigneeType, newAssigneeType: input.assigneeType,
            ...(reason ? { reason } : {}),
          },
        },
      }
    })
  }

  async setStepWaiting(metadata: TaskCommandMetadata, taskId: string, expectedVersion: number, rawReason: string) {
    const input = stepWaitingSchema.parse({ taskId, expectedVersion, reason: rawReason })
    const reason = normalizeWaitingReason(input.reason)
    const snapshot = await this.readCurrentStepSnapshot(metadata.organizationId, input.taskId, metadata.principal.userId)
    const eligible = stepEligibility(metadata.principal, snapshot.step, snapshot.callerEmployment)
    const context = await this.authorized(metadata, 'task.transition', input.taskId, {
      assigneeUserIds: eligible ? [metadata.principal.userId] : [],
    })
    return this.audit.execute(context, async (transaction) => {
      const taskPath = tenantDocumentPath(metadata.organizationId, 'task', input.taskId)
      const task = await owned(transaction, taskPath, metadata.organizationId)
      assertExpected(task, input.expectedVersion)
      const currentOrder = Number(task.currentStepOrder)
      const currentStepPath = stepPath(metadata.organizationId, input.taskId, currentOrder)
      const currentStep = await owned(transaction, currentStepPath, metadata.organizationId)
      if (!stepEligibility(metadata.principal, currentStep, snapshot.callerEmployment)) throw new Error('STEP_HOLDER_REQUIRED')
      assertStepStatusTransition(currentStep.status as TaskStepStatus, 'waiting')
      const nextVersion = Number(task.version) + 1
      // Write phase.
      transaction.update(currentStepPath, {
        status: 'waiting' as const, waitingReason: reason,
        version: Number(currentStep.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(taskPath, {
        version: nextVersion, updatedAt: SERVER_TIMESTAMP,
        currentStepStatus: 'waiting' as const, currentStepWaitingReason: reason,
      })
      transaction.create(tenantDocumentPath(metadata.organizationId, 'task_step_event', stepEventId(input.taskId, currentOrder, Number(task.version))), {
        ...base(metadata.organizationId), taskId: input.taskId, stepOrder: currentOrder,
        fromStatus: currentStep.status, toStatus: 'waiting', actorUserId: metadata.principal.userId,
        reason, occurredAt: SERVER_TIMESTAMP,
      })
      return {
        result: { taskId: input.taskId, version: nextVersion, currentStepOrder: currentOrder, currentStepStatus: 'waiting' as const },
        resourceType: 'task', resourceId: input.taskId,
        outbox: { type: 'task.updated', version: 1, payload: { taskId: input.taskId } },
      }
    })
  }

  async resumeStep(metadata: TaskCommandMetadata, taskId: string, expectedVersion: number) {
    const input = resumeStepSchema.parse({ taskId, expectedVersion })
    const snapshot = await this.readCurrentStepSnapshot(metadata.organizationId, input.taskId, metadata.principal.userId)
    const eligible = stepEligibility(metadata.principal, snapshot.step, snapshot.callerEmployment)
    const context = await this.authorized(metadata, 'task.transition', input.taskId, {
      assigneeUserIds: eligible ? [metadata.principal.userId] : [],
    })
    return this.audit.execute(context, async (transaction) => {
      const taskPath = tenantDocumentPath(metadata.organizationId, 'task', input.taskId)
      const task = await owned(transaction, taskPath, metadata.organizationId)
      assertExpected(task, input.expectedVersion)
      const currentOrder = Number(task.currentStepOrder)
      const currentStepPath = stepPath(metadata.organizationId, input.taskId, currentOrder)
      const currentStep = await owned(transaction, currentStepPath, metadata.organizationId)
      if (!stepEligibility(metadata.principal, currentStep, snapshot.callerEmployment)) throw new Error('STEP_HOLDER_REQUIRED')
      assertStepStatusTransition(currentStep.status as TaskStepStatus, 'in_progress')
      const nextVersion = Number(task.version) + 1
      // Resuming starts a fresh active interval: time explicitly spent waiting never counts as stalled.
      transaction.update(currentStepPath, {
        status: 'in_progress' as const, waitingReason: null,
        version: Number(currentStep.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(taskPath, {
        version: nextVersion, updatedAt: SERVER_TIMESTAMP,
        currentStepStatus: 'in_progress' as const, currentStepWaitingReason: null,
        currentStepEnteredAt: SERVER_TIMESTAMP,
      })
      transaction.create(tenantDocumentPath(metadata.organizationId, 'task_step_event', stepEventId(input.taskId, currentOrder, Number(task.version))), {
        ...base(metadata.organizationId), taskId: input.taskId, stepOrder: currentOrder,
        fromStatus: currentStep.status, toStatus: 'in_progress', actorUserId: metadata.principal.userId,
        occurredAt: SERVER_TIMESTAMP,
      })
      return {
        result: { taskId: input.taskId, version: nextVersion, currentStepOrder: currentOrder, currentStepStatus: 'in_progress' as const },
        resourceType: 'task', resourceId: input.taskId,
        outbox: { type: 'task.updated', version: 1, payload: { taskId: input.taskId } },
      }
    })
  }

  /** Sets/clears one step's own due date after creation (Area 4) — independent of the task-level dueAt.
   * If the step being edited is the CURRENT step, keeps the task doc's denormalized currentStepDueAt in
   * sync so stalled-task computation (isTaskStalled(), domain/task.ts) stays correct without a second call. */
  async setStepDueDate(metadata: TaskCommandMetadata, raw: z.input<typeof setStepDueDateSchema>) {
    const input = setStepDueDateSchema.parse(raw)
    if (input.dueAt) assertTaskDueAt(input.dueAt)
    const context = await this.authorized(metadata, 'task.update', input.taskId)
    return this.audit.execute(context, async (transaction) => {
      const taskPath = tenantDocumentPath(metadata.organizationId, 'task', input.taskId)
      const task = await owned(transaction, taskPath, metadata.organizationId)
      const path = stepPath(metadata.organizationId, input.taskId, input.stepOrder)
      const step = await owned(transaction, path, metadata.organizationId)
      assertExpected(step, input.expectedVersion)
      transaction.update(path, { dueAt: input.dueAt, version: input.expectedVersion + 1, updatedAt: SERVER_TIMESTAMP })
      if (Number(task.currentStepOrder) === input.stepOrder) {
        transaction.update(taskPath, { currentStepDueAt: input.dueAt, updatedAt: SERVER_TIMESTAMP })
      }
      return {
        result: { taskId: input.taskId, stepOrder: input.stepOrder, version: input.expectedVersion + 1, dueAt: input.dueAt },
        resourceType: 'task_step', resourceId: `${input.taskId}-step-${input.stepOrder}`,
        outbox: { type: 'task.updated', version: 1, payload: { taskId: input.taskId } },
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

  /** addSubtask() creates a subtask but nothing could ever mark one done — this is the missing status
   * command, mirroring setChecklistItem's shape/permission ('subtask.manage', the same permission
   * addSubtask itself requires) so a subtask's lifecycle is symmetric with a checklist item's. */
  async setSubtaskStatus(metadata: TaskCommandMetadata, subtaskId: string, expectedVersion: number, status: 'ready' | 'in_progress' | 'done') {
    id.parse(subtaskId); version.parse(expectedVersion)
    const context = await this.authorized(metadata, 'subtask.manage')
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'subtask', subtaskId)
      const subtask = await owned(transaction, path, metadata.organizationId)
      assertExpected(subtask, expectedVersion)
      const task = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task', String(subtask.taskId)), metadata.organizationId)
      if (TERMINAL_TASK_STATUSES.has(task.status as TaskStatus)) throw new Error('TASK_TERMINAL_IMMUTABLE')
      transaction.update(path, { status, version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { subtaskId, version: expectedVersion + 1, status },
        resourceType: 'subtask', resourceId: subtaskId,
        outbox: { type: 'subtask.status_updated', version: 1, payload: { taskId: subtask.taskId, subtaskId, status } },
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

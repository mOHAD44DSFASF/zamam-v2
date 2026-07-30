import type { AuthorizationPrincipal, AuthorizationRequest, Permission } from '@zamam/authorization'
import { isPermission } from '@zamam/authorization'
import { SCHEMA_VERSION, TERMINAL_TASK_STATUSES, type TaskStatus, type WorkflowDefinition } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type AtomicTransaction, type PageQuery } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const version = z.number().int().positive()

export interface WorkflowExecutionAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface WorkflowExecutionMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface WorkflowGatePort {
  validate(input: {
    organizationId: string
    taskId: string
    instanceId: string
    stageKey: string
    transitionKey: string
    actorUserId: string
  }): Promise<{ valid: boolean; errors: readonly string[] }>
}
export interface BusinessCalendarPort {
  addBusinessMinutes(organizationId: string, from: string, minutes: number): Promise<string>
}
export interface WorkflowClock { now(): string }

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
const definitionFrom = (record: Readonly<Record<string, unknown>>) => record.definition as WorkflowDefinition
const executionId = (instanceId: string, cycle: number, stageKey: string) => `${instanceId}_${cycle}_${stageKey}`

export function buildOverdueWorkflowQuery(input: { organizationId: string; now: string; limit?: number; cursor?: readonly unknown[] }): PageQuery {
  id.parse(input.organizationId)
  z.string().datetime().parse(input.now)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'task_workflow_instance',
    filters: [
      { field: 'status', operator: '==', value: 'active' },
      { field: 'stageDueAt', operator: '<=', value: input.now },
    ],
    orderBy: [{ field: 'stageDueAt', direction: 'asc' }], limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class WorkflowExecutionService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: WorkflowExecutionAuthorizationGate,
    private readonly gates: WorkflowGatePort,
    private readonly calendar: BusinessCalendarPort,
    private readonly clock: WorkflowClock,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  private context(metadata: WorkflowExecutionMetadata, permission: Permission) {
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async start(metadata: WorkflowExecutionMetadata, input: {
    instanceId: string
    taskId: string
    workflowVersionId: string
    expectedTaskVersion: number
  }) {
    for (const value of [input.instanceId, input.taskId, input.workflowVersionId]) id.parse(value)
    version.parse(input.expectedTaskVersion)
    await this.authorization.require(metadata.principal, {
      permission: 'task.transition', organizationId: metadata.organizationId,
      resource: { type: 'task', id: input.taskId, organizationId: metadata.organizationId, visibility: 'internal' },
    })
    const now = this.clock.now()
    return this.audit.execute(this.context(metadata, 'task.transition'), async (transaction) => {
      const taskPath = tenantDocumentPath(metadata.organizationId, 'task', input.taskId)
      const task = await owned(transaction, taskPath, metadata.organizationId)
      if (task.version !== input.expectedTaskVersion) throw new Error('VERSION_CONFLICT')
      if (task.workflowInstanceId || TERMINAL_TASK_STATUSES.has(task.status as TaskStatus)) throw new Error('TASK_WORKFLOW_START_DENIED')
      const workflow = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workflow_version', input.workflowVersionId), metadata.organizationId)
      if (workflow.status !== 'published') throw new Error('WORKFLOW_VERSION_NOT_PUBLISHED')
      const definition = definitionFrom(workflow)
      const stage = definition.stages.find(({ key }) => key === definition.startStageKey)
      if (!stage) throw new Error('WORKFLOW_START_INVALID')
      const stageId = `${input.workflowVersionId}_${stage.key}`
      const dueAt = stage.slaMinutes ? await this.calendar.addBusinessMinutes(metadata.organizationId, now, stage.slaMinutes) : undefined
      const instancePath = tenantDocumentPath(metadata.organizationId, 'task_workflow_instance', input.instanceId)
      if (await transaction.get(instancePath)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(instancePath, {
        ...base(metadata.organizationId), taskId: input.taskId, workflowVersionId: input.workflowVersionId,
        currentStageId: stageId, currentStageKey: stage.key, status: stage.terminal ? 'completed' : 'active',
        concurrencyVersion: 1, cycle: 1, ...(dueAt ? { stageDueAt: dueAt } : {}),
      })
      transaction.create(tenantDocumentPath(metadata.organizationId, 'task_stage_execution', executionId(input.instanceId, 1, stage.key)), {
        ...base(metadata.organizationId), workflowInstanceId: input.instanceId, stageId, stageKey: stage.key,
        cycle: 1, status: stage.terminal ? 'completed' : 'active', enteredAt: now, actorUserId: metadata.principal.userId,
      })
      transaction.update(taskPath, { workflowInstanceId: input.instanceId, version: input.expectedTaskVersion + 1, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { instanceId: input.instanceId, workflowVersionId: input.workflowVersionId, currentStageKey: stage.key, concurrencyVersion: 1 },
        resourceType: 'task_workflow_instance', resourceId: input.instanceId,
        outbox: { type: 'workflow.instance_started', version: 1, payload: { instanceId: input.instanceId, taskId: input.taskId, workflowVersionId: input.workflowVersionId } },
      }
    })
  }

  async transition(metadata: WorkflowExecutionMetadata, input: {
    instanceId: string
    transitionKey: string
    expectedConcurrencyVersion: number
  }) {
    id.parse(input.instanceId); version.parse(input.expectedConcurrencyVersion)
    const replay = await this.audit.replay<{
      instanceId: string
      currentStageKey: string
      concurrencyVersion: number
      status: 'active' | 'completed'
    }>({
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    })
    if (replay) return replay
    const snapshot = await this.store.runTransaction(async (transaction) => {
      const instance = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'task_workflow_instance', input.instanceId), metadata.organizationId)
      const workflow = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workflow_version', String(instance.workflowVersionId)), metadata.organizationId)
      const definition = definitionFrom(workflow)
      const transition = definition.transitions.find(({ key }) => key === input.transitionKey && definition.stages.some(({ key }) => key === instance.currentStageKey))
      if (!transition || transition.from !== instance.currentStageKey) throw new Error('WORKFLOW_TRANSITION_NOT_AVAILABLE')
      return { instance, workflow, definition, transition }
    })
    if (!isPermission(snapshot.transition.requiredPermission)) throw new Error('WORKFLOW_PERMISSION_INVALID')
    const permission = snapshot.transition.requiredPermission
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId,
      resource: {
        type: 'task_workflow_instance', id: input.instanceId, organizationId: metadata.organizationId,
        ownerUserId: String(snapshot.instance.taskId), visibility: 'internal', state: String(snapshot.instance.status),
      },
    })
    const gate = await this.gates.validate({
      organizationId: metadata.organizationId, taskId: String(snapshot.instance.taskId),
      instanceId: input.instanceId, stageKey: String(snapshot.instance.currentStageKey),
      transitionKey: input.transitionKey, actorUserId: metadata.principal.userId,
    })
    if (!gate.valid) throw new Error(gate.errors[0] ?? 'WORKFLOW_GATE_DENIED')
    const now = this.clock.now()
    return this.audit.execute(this.context(metadata, permission), async (transaction) => {
      const instancePath = tenantDocumentPath(metadata.organizationId, 'task_workflow_instance', input.instanceId)
      const instance = await owned(transaction, instancePath, metadata.organizationId)
      if (instance.status !== 'active') throw new Error('WORKFLOW_INSTANCE_NOT_ACTIVE')
      if (instance.concurrencyVersion !== input.expectedConcurrencyVersion) throw new Error('VERSION_CONFLICT')
      if (instance.workflowVersionId !== snapshot.instance.workflowVersionId || instance.currentStageKey !== snapshot.transition.from) {
        throw new Error('WORKFLOW_TRANSITION_RACE')
      }
      const workflow = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workflow_version', String(instance.workflowVersionId)), metadata.organizationId)
      if (workflow.status !== 'published' && workflow.status !== 'archived') throw new Error('WORKFLOW_VERSION_INVALID')
      const definition = definitionFrom(workflow)
      const transition = definition.transitions.find(({ key }) => key === input.transitionKey && fromCurrent(instance.currentStageKey, { from: snapshot.transition.from }))
      if (!transition || transition.to !== snapshot.transition.to) throw new Error('WORKFLOW_DEFINITION_CHANGED')
      const nextStage = definition.stages.find(({ key }) => key === transition.to)
      if (!nextStage) throw new Error('WORKFLOW_STAGE_NOT_FOUND')
      const nextCycle = definition.stages.findIndex(({ key }) => key === nextStage.key) <= definition.stages.findIndex(({ key }) => key === instance.currentStageKey)
        ? Number(instance.cycle) + 1 : Number(instance.cycle)
      const nextStageId = `${instance.workflowVersionId}_${nextStage.key}`
      const dueAt = nextStage.slaMinutes ? await this.calendar.addBusinessMinutes(metadata.organizationId, now, nextStage.slaMinutes) : undefined
      // Read phase — both the current and next stage-execution docs are read before any write (Firestore
      // transaction rule; the next-execution get() previously followed the current-execution update()).
      const currentExecutionPath = tenantDocumentPath(metadata.organizationId, 'task_stage_execution', executionId(input.instanceId, Number(instance.cycle), String(instance.currentStageKey)))
      const currentExecution = await owned(transaction, currentExecutionPath, metadata.organizationId)
      const nextExecutionPath = tenantDocumentPath(metadata.organizationId, 'task_stage_execution', executionId(input.instanceId, nextCycle, nextStage.key))
      const nextExecutionExisting = await transaction.get(nextExecutionPath)
      if (currentExecution.status !== 'active') throw new Error('WORKFLOW_EXECUTION_RACE')
      if (nextExecutionExisting) throw new Error('WORKFLOW_EXECUTION_ALREADY_EXISTS')
      // Write phase.
      transaction.update(currentExecutionPath, {
        status: 'completed', exitedAt: now, transitionId: transition.key,
        version: Number(currentExecution.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.create(nextExecutionPath, {
        ...base(metadata.organizationId), workflowInstanceId: input.instanceId, stageId: nextStageId,
        stageKey: nextStage.key, cycle: nextCycle, status: nextStage.terminal ? 'completed' : 'active',
        enteredAt: now, actorUserId: metadata.principal.userId,
        ...(nextStage.terminal ? { exitedAt: now } : {}),
      })
      const nextConcurrency = input.expectedConcurrencyVersion + 1
      transaction.update(instancePath, {
        currentStageId: nextStageId, currentStageKey: nextStage.key, cycle: nextCycle,
        status: nextStage.terminal ? 'completed' : 'active', concurrencyVersion: nextConcurrency,
        version: Number(instance.version) + 1, updatedAt: SERVER_TIMESTAMP,
        stageDueAt: dueAt ?? null,
      })
      return {
        result: { instanceId: input.instanceId, currentStageKey: nextStage.key, concurrencyVersion: nextConcurrency, status: nextStage.terminal ? 'completed' as const : 'active' as const },
        resourceType: 'task_workflow_instance', resourceId: input.instanceId,
        outbox: { type: 'task.transitioned', version: 1, payload: { instanceId: input.instanceId, taskId: instance.taskId, from: transition.from, to: transition.to, cycle: nextCycle } },
      }
    })
  }

  async migrateVersion(metadata: WorkflowExecutionMetadata, input: {
    instanceId: string
    targetWorkflowVersionId: string
    expectedConcurrencyVersion: number
    reason: string
  }) {
    id.parse(input.instanceId); id.parse(input.targetWorkflowVersionId); version.parse(input.expectedConcurrencyVersion)
    if (input.reason.trim().length < 10) throw new Error('WORKFLOW_MIGRATION_REASON_REQUIRED')
    await this.authorization.require(metadata.principal, {
      permission: 'workflow.migrate_instances', organizationId: metadata.organizationId, requireStepUp: true,
      resource: { type: 'task_workflow_instance', id: input.instanceId, organizationId: metadata.organizationId, visibility: 'internal' },
    })
    return this.audit.execute(this.context(metadata, 'workflow.migrate_instances'), async (transaction) => {
      const instancePath = tenantDocumentPath(metadata.organizationId, 'task_workflow_instance', input.instanceId)
      const instance = await owned(transaction, instancePath, metadata.organizationId)
      if (instance.status !== 'active' || instance.concurrencyVersion !== input.expectedConcurrencyVersion) throw new Error('VERSION_CONFLICT')
      const target = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workflow_version', input.targetWorkflowVersionId), metadata.organizationId)
      if (target.status !== 'published' || target.templateId !== (await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workflow_version', String(instance.workflowVersionId)), metadata.organizationId)).templateId) {
        throw new Error('WORKFLOW_MIGRATION_TARGET_INVALID')
      }
      const targetStage = definitionFrom(target).stages.find(({ key }) => key === instance.currentStageKey)
      if (!targetStage) throw new Error('WORKFLOW_MIGRATION_INCOMPATIBLE_STAGE')
      transaction.update(instancePath, {
        workflowVersionId: input.targetWorkflowVersionId,
        currentStageId: `${input.targetWorkflowVersionId}_${targetStage.key}`,
        migrationReason: input.reason.trim(), migratedBy: metadata.principal.userId, migratedAt: SERVER_TIMESTAMP,
        concurrencyVersion: input.expectedConcurrencyVersion + 1, version: Number(instance.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { instanceId: input.instanceId, workflowVersionId: input.targetWorkflowVersionId, concurrencyVersion: input.expectedConcurrencyVersion + 1 },
        resourceType: 'task_workflow_instance', resourceId: input.instanceId,
        outbox: { type: 'workflow.instance_migrated', version: 1, payload: { instanceId: input.instanceId, fromVersionId: instance.workflowVersionId, toVersionId: input.targetWorkflowVersionId } },
      }
    })
  }

  async markSlaBreached(metadata: WorkflowExecutionMetadata, instanceId: string, expectedConcurrencyVersion: number) {
    id.parse(instanceId); version.parse(expectedConcurrencyVersion)
    await this.authorization.require(metadata.principal, {
      permission: 'task.override_transition', organizationId: metadata.organizationId,
      resource: { type: 'task_workflow_instance', id: instanceId, organizationId: metadata.organizationId, visibility: 'internal' },
    })
    const now = this.clock.now()
    return this.audit.execute(this.context(metadata, 'task.override_transition'), async (transaction) => {
      const instancePath = tenantDocumentPath(metadata.organizationId, 'task_workflow_instance', instanceId)
      const instance = await owned(transaction, instancePath, metadata.organizationId)
      if (instance.status !== 'active' || instance.concurrencyVersion !== expectedConcurrencyVersion) throw new Error('VERSION_CONFLICT')
      if (!instance.stageDueAt || String(instance.stageDueAt) > now) throw new Error('WORKFLOW_SLA_NOT_DUE')
      if (instance.slaBreachedAt) throw new Error('WORKFLOW_SLA_ALREADY_RECORDED')
      const executionPath = tenantDocumentPath(metadata.organizationId, 'task_stage_execution', executionId(instanceId, Number(instance.cycle), String(instance.currentStageKey)))
      const execution = await owned(transaction, executionPath, metadata.organizationId)
      transaction.update(executionPath, { slaBreachedAt: now, version: Number(execution.version) + 1, updatedAt: SERVER_TIMESTAMP })
      transaction.update(instancePath, { slaBreachedAt: now, version: Number(instance.version) + 1, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { instanceId, slaBreachedAt: now },
        resourceType: 'task_workflow_instance', resourceId: instanceId,
        outbox: { type: 'workflow.sla_breached', version: 1, payload: { instanceId, taskId: instance.taskId, stageKey: instance.currentStageKey } },
      }
    })
  }
}

function fromCurrent(current: unknown, transition: { from: string }) {
  return current === transition.from
}

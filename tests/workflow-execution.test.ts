import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import type { WorkflowDefinition } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  WorkflowExecutionService, buildOverdueWorkflowQuery,
  type BusinessCalendarPort, type WorkflowExecutionAuthorizationGate,
  type WorkflowExecutionMetadata, type WorkflowGatePort,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => { if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: ${path}`); return working.get(path) ?? null },
      create: (path, data) => { writeStarted = true; if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, { ...data }) },
      update: (path, data) => { writeStarted = true; const current = working.get(path); if (!current) throw new Error('NOT_FOUND'); working.set(path, { ...current, ...data }) },
    }
    const result = await operation(transaction); this.records = working; return result
  }
}
class Gate implements WorkflowExecutionAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) }
}
const principal: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (): WorkflowExecutionMetadata => ({
  organizationId: 'org-1', principal,
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const definition: WorkflowDefinition = {
  startStageKey: 'write',
  stages: [
    { key: 'write', name: 'الكتابة', type: 'work', terminal: false, slaMinutes: 60 },
    { key: 'review', name: 'المراجعة', type: 'review', terminal: false, slaMinutes: 30 },
    { key: 'done', name: 'مكتمل', type: 'work', terminal: true },
  ],
  transitions: [
    { key: 'submit', from: 'write', to: 'review', requiredPermission: 'task.transition' },
    { key: 'approve', from: 'review', to: 'done', requiredPermission: 'review.perform' },
    { key: 'rework', from: 'review', to: 'write', requiredPermission: 'review.perform' },
  ],
}
const now = '2026-08-01T08:00:00.000Z'
const calendar: BusinessCalendarPort = {
  addBusinessMinutes: async (_organizationId, _from, minutes) => `2026-08-01T${minutes === 60 ? '09:00' : '08:30'}:00.000Z`,
}
const gates = (valid = true): WorkflowGatePort => ({ validate: async () => ({ valid, errors: valid ? [] : ['CHECKLIST_INCOMPLETE'] }) })
function seed(store: MemoryStore, versionId = 'workflow-v1', candidate = definition) {
  store.records.set('v2Organizations/org-1/task/task-1', { organizationId: 'org-1', status: 'in_progress', version: 1 })
  store.records.set(`v2Organizations/org-1/workflow_version/${versionId}`, {
    organizationId: 'org-1', templateId: 'template-1', status: 'published', version: 1, definition: candidate,
  })
}
function service(store: MemoryStore, valid = true, gate = new Gate()) {
  return { service: new WorkflowExecutionService(store, gate, gates(valid), calendar, { now: () => now }), gate }
}
async function started(store: MemoryStore) {
  const result = service(store)
  await result.service.start(metadata(), { instanceId: 'instance-1', taskId: 'task-1', workflowVersionId: 'workflow-v1', expectedTaskVersion: 1 })
  return result
}

describe('workflow execution engine', () => {
  it('pins a task to a published version and opens the first execution with SLA', async () => {
    const store = new MemoryStore(); seed(store)
    await started(store)
    expect(store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1')).toMatchObject({
      workflowVersionId: 'workflow-v1', currentStageKey: 'write', concurrencyVersion: 1,
      cycle: 1, status: 'active', stageDueAt: '2026-08-01T09:00:00.000Z',
    })
    expect(store.records.get('v2Organizations/org-1/task/task-1')).toMatchObject({ workflowInstanceId: 'instance-1', version: 2 })
  })

  it('rejects an unpublished version atomically', async () => {
    const store = new MemoryStore(); seed(store)
    store.records.set('v2Organizations/org-1/workflow_version/workflow-v1', {
      organizationId: 'org-1', templateId: 'template-1', status: 'draft', version: 1, definition,
    })
    await expect(service(store).service.start(metadata(), {
      instanceId: 'instance-1', taskId: 'task-1', workflowVersionId: 'workflow-v1', expectedTaskVersion: 1,
    })).rejects.toThrow('WORKFLOW_VERSION_NOT_PUBLISHED')
    expect(store.records.has('v2Organizations/org-1/task_workflow_instance/instance-1')).toBe(false)
  })

  it('transitions exactly once, closes the old execution and opens the next', async () => {
    const store = new MemoryStore(); seed(store)
    const { service: engine, gate } = await started(store)
    const command = metadata()
    const first = await engine.transition(command, { instanceId: 'instance-1', transitionKey: 'submit', expectedConcurrencyVersion: 1 })
    const replay = await engine.transition(command, { instanceId: 'instance-1', transitionKey: 'submit', expectedConcurrencyVersion: 1 })
    expect(replay).toEqual({ ...first, replayed: true })
    expect(store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1')).toMatchObject({ currentStageKey: 'review', concurrencyVersion: 2 })
    expect(store.records.get('v2Organizations/org-1/task_stage_execution/instance-1_1_write')).toMatchObject({ status: 'completed', transitionId: 'submit' })
    expect(gate.requests.at(-1)).toMatchObject({ permission: 'task.transition' })
  })

  it('rejects a stale racing transition without changing the current stage', async () => {
    const store = new MemoryStore(); seed(store)
    const { service: engine } = await started(store)
    await engine.transition(metadata(), { instanceId: 'instance-1', transitionKey: 'submit', expectedConcurrencyVersion: 1 })
    await expect(engine.transition(metadata(), { instanceId: 'instance-1', transitionKey: 'approve', expectedConcurrencyVersion: 1 }))
      .rejects.toThrow('VERSION_CONFLICT')
    expect(store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1')).toMatchObject({ currentStageKey: 'review' })
  })

  it('fails before mutation when trusted transition gates are incomplete', async () => {
    const store = new MemoryStore(); seed(store)
    await started(store)
    const engine = service(store, false).service
    await expect(engine.transition(metadata(), { instanceId: 'instance-1', transitionKey: 'submit', expectedConcurrencyVersion: 1 }))
      .rejects.toThrow('CHECKLIST_INCOMPLETE')
    expect(store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1')).toMatchObject({ currentStageKey: 'write', concurrencyVersion: 1 })
  })

  it('increments the cycle on a rework path and retains previous executions', async () => {
    const store = new MemoryStore(); seed(store)
    const { service: engine } = await started(store)
    await engine.transition(metadata(), { instanceId: 'instance-1', transitionKey: 'submit', expectedConcurrencyVersion: 1 })
    await engine.transition(metadata(), { instanceId: 'instance-1', transitionKey: 'rework', expectedConcurrencyVersion: 2 })
    expect(store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1')).toMatchObject({ currentStageKey: 'write', cycle: 2, concurrencyVersion: 3 })
    expect(store.records.has('v2Organizations/org-1/task_stage_execution/instance-1_1_write')).toBe(true)
    expect(store.records.has('v2Organizations/org-1/task_stage_execution/instance-1_2_write')).toBe(true)
  })

  it('migrates only to a compatible published version with an audit reason', async () => {
    const store = new MemoryStore(); seed(store); seed(store, 'workflow-v2')
    const { service: engine, gate } = await started(store)
    await engine.migrateVersion(metadata(), {
      instanceId: 'instance-1', targetWorkflowVersionId: 'workflow-v2',
      expectedConcurrencyVersion: 1, reason: 'ترقية صريحة إلى الإصدار المصحح',
    })
    expect(store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1')).toMatchObject({
      workflowVersionId: 'workflow-v2', concurrencyVersion: 2,
    })
    expect(gate.requests.at(-1)).toMatchObject({ permission: 'workflow.migrate_instances', requireStepUp: true })
  })

  it('records an overdue SLA once and emits escalation evidence', async () => {
    const store = new MemoryStore(); seed(store)
    const { service: engine } = await started(store)
    store.records.set('v2Organizations/org-1/task_workflow_instance/instance-1', {
      ...store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1'),
      stageDueAt: '2026-08-01T07:00:00.000Z',
    })
    await engine.markSlaBreached(metadata(), 'instance-1', 1)
    expect(store.records.get('v2Organizations/org-1/task_workflow_instance/instance-1')).toMatchObject({ slaBreachedAt: now })
    await expect(engine.markSlaBreached(metadata(), 'instance-1', 1)).rejects.toThrow('WORKFLOW_SLA_ALREADY_RECORDED')
  })

  it('builds bounded ordered overdue scans', () => {
    expect(buildOverdueWorkflowQuery({ organizationId: 'org-1', now })).toMatchObject({
      entityKind: 'task_workflow_instance', limit: 50,
      orderBy: [{ field: 'stageDueAt', direction: 'asc' }],
    })
    expect(() => buildOverdueWorkflowQuery({ organizationId: 'org-1', now, limit: 100 })).toThrow('UNBOUNDED_QUERY_DENIED')
  })
})


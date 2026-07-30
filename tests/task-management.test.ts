import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { assertTaskStatusTransition, normalizeTaskTitle } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import { TaskService, type TaskAuthorizationGate, type TaskCommandMetadata, type TaskReferencePort } from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => { if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: ${path}`); return working.get(path) ?? null },
      create: (path, data) => {
        writeStarted = true
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
        writeStarted = true
        const current = working.get(path)
        if (!current) throw new Error('NOT_FOUND')
        working.set(path, { ...current, ...data })
      },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}
class Gate implements TaskAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) }
}
const principal: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (): TaskCommandMetadata => ({
  organizationId: 'org-1', principal,
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const references = (count = 0): TaskReferencePort => ({ activeWorkflowInstanceCount: async () => count })
function seed(store: MemoryStore) {
  store.records.set('v2Organizations/org-1/project/project-1', { organizationId: 'org-1', status: 'active' })
  store.records.set('v2Organizations/org-1/workspace/workspace-1', { organizationId: 'org-1', status: 'active', projectId: 'project-1' })
  store.records.set('v2Organizations/org-1/employment_profile/user-1', { organizationId: 'org-1', status: 'active' })
  store.records.set('v2Organizations/org-1/employment_profile/user-2', { organizationId: 'org-1', status: 'active' })
  store.records.set('v2Organizations/org-1/team/team-1', { organizationId: 'org-1', status: 'active' })
}
async function createTask(store: MemoryStore, id = 'task-1') {
  const service = new TaskService(store, new Gate(), references())
  await service.create(metadata(), {
    id, projectId: 'project-1', workspaceId: 'workspace-1',
    title: '  مهمة   أساسية ', description: 'تفاصيل', priority: 'high', clientVisible: false,
  })
  return service
}

describe('task domain', () => {
  it('normalizes titles and enforces the lifecycle graph', () => {
    expect(normalizeTaskTitle('  مهمة   واضحة ')).toBe('مهمة واضحة')
    expect(() => assertTaskStatusTransition('draft', 'completed')).toThrow('INVALID_TASK_STATUS_TRANSITION')
    expect(() => assertTaskStatusTransition('in_progress', 'completed')).not.toThrow()
  })
})

describe('task service', () => {
  it('creates a tenant task only for compatible active project/workspace references', async () => {
    const store = new MemoryStore(); seed(store)
    await createTask(store)
    expect(store.records.get('v2Organizations/org-1/task/task-1')).toMatchObject({
      organizationId: 'org-1', title: 'مهمة أساسية', status: 'draft', createdBy: 'user-1', version: 1,
    })
    store.records.set('v2Organizations/org-1/workspace/other', { organizationId: 'org-1', status: 'active', projectId: 'project-2' })
    await expect(new TaskService(store, new Gate(), references()).create(metadata(), {
      id: 'task-2', projectId: 'project-1', workspaceId: 'other', title: 'مهمة متعارضة',
    })).rejects.toThrow('TASK_WORKSPACE_SCOPE_CONFLICT')
  })

  it('uses optimistic concurrency and makes completed tasks immutable', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    await service.update(metadata(), { taskId: 'task-1', expectedVersion: 1, title: 'عنوان جديد' })
    await expect(service.update(metadata(), { taskId: 'task-1', expectedVersion: 1, title: 'قديم' })).rejects.toThrow('VERSION_CONFLICT')
    await service.transition(metadata(), 'task-1', 2, 'ready')
    await service.transition(metadata(), 'task-1', 3, 'in_progress')
    await service.transition(metadata(), 'task-1', 4, 'completed')
    await expect(service.update(metadata(), { taskId: 'task-1', expectedVersion: 5, title: 'ممنوع' })).rejects.toThrow('TASK_TERMINAL_IMMUTABLE')
  })

  it('requires a reason for blocked and audited reopen', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    await service.transition(metadata(), 'task-1', 1, 'ready')
    await expect(service.transition(metadata(), 'task-1', 2, 'blocked')).rejects.toThrow('TASK_BLOCK_REASON_REQUIRED')
    await service.transition(metadata(), 'task-1', 2, 'in_progress')
    await service.transition(metadata(), 'task-1', 3, 'completed')
    await expect(service.reopen(metadata(), 'task-1', 4, 'قصير')).rejects.toThrow('INVALID_REOPEN_REASON')
    await service.reopen(metadata(), 'task-1', 4, 'إعادة فتح موثقة بسبب تعديل متطلبات العميل')
    expect(store.records.get('v2Organizations/org-1/task/task-1')).toMatchObject({ status: 'ready', completedAt: null, version: 5 })
  })

  it('creates bounded subtasks and checklist items under a mutable task', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    await service.addSubtask(metadata(), { id: 'subtask-1', taskId: 'task-1', title: 'جزء أول', assigneeUserId: 'user-2' })
    await service.createChecklist(metadata(), {
      id: 'checklist-1', taskId: 'task-1', title: 'قائمة التسليم', required: true,
      items: [{ id: 'item-1', text: 'مراجعة العنوان', required: true }],
    })
    await service.setChecklistItem(metadata(), 'item-1', 1, true)
    expect(store.records.get('v2Organizations/org-1/checklist_item/item-1')).toMatchObject({
      completed: true, completedBy: 'user-1', version: 2,
    })
  })

  it('creates a pending assignment without turning ownership into permission', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    await service.assign(metadata(), {
      id: 'assignment-1', taskId: 'task-1', userId: 'user-2', assignmentRole: 'responsible',
    })
    expect(store.records.get('v2Organizations/org-1/task_assignment/assignment-1')).toMatchObject({
      userId: 'user-2', status: 'pending', assignedBy: 'user-1',
    })
    await expect(service.respondToAssignment(metadata(), 'assignment-1', 1, 'accepted')).rejects.toThrow('ASSIGNMENT_RESPONSE_DENIED')
  })

  it('allows only the assigned user to accept once', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    await service.assign(metadata(), { id: 'assignment-2', taskId: 'task-1', userId: 'user-1', assignmentRole: 'contributor' })
    await service.respondToAssignment(metadata(), 'assignment-2', 1, 'accepted')
    await expect(service.respondToAssignment(metadata(), 'assignment-2', 2, 'declined')).rejects.toThrow('ASSIGNMENT_RESPONSE_DENIED')
  })

  it('blocks archive with an active workflow instance', async () => {
    const store = new MemoryStore(); seed(store)
    await createTask(store)
    const service = new TaskService(store, new Gate(), references(1))
    await expect(service.archive(metadata(), 'task-1', 1)).rejects.toThrow('TASK_HAS_ACTIVE_WORKFLOW')
  })

  it('is idempotent and emits one audit/outbox sequence per logical command', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references())
    const command = metadata()
    const first = await service.create(command, { id: 'task-idem', projectId: 'project-1', title: 'مهمة ثابتة' })
    const replay = await service.create(command, { id: 'task-idem', projectId: 'project-1', title: 'مهمة ثابتة' })
    expect(replay).toEqual({ ...first, replayed: true })
    expect([...store.records.keys()].filter((path) => path.includes('/_auditEvents/'))).toHaveLength(1)
  })
})


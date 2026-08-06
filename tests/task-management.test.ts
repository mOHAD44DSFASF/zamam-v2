import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { assertTaskStatusTransition, normalizeTaskTitle } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  TaskService, type TaskAuthorizationGate, type TaskCommandMetadata,
  type TaskDepartmentMembersPort, type TaskReferencePort,
} from '../services/functions/src'

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
const principal = (userId = 'user-1'): AuthorizationPrincipal => ({
  userId, authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
})
let sequence = 0
const metadata = (actor: AuthorizationPrincipal = principal()): TaskCommandMetadata => ({
  organizationId: 'org-1', principal: actor,
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const references = (count = 0): TaskReferencePort => ({ activeWorkflowInstanceCount: async () => count })
const departmentsPort = (members: Readonly<Record<string, readonly string[]>> = {}): TaskDepartmentMembersPort => ({
  activeMembers: async (_organizationId, departmentId) => members[departmentId] ?? [],
})
function seed(store: MemoryStore) {
  store.records.set('v2Organizations/org-1/project/project-1', { organizationId: 'org-1', status: 'active' })
  store.records.set('v2Organizations/org-1/workspace/workspace-1', { organizationId: 'org-1', status: 'active', projectId: 'project-1' })
  store.records.set('v2Organizations/org-1/employment_profile/user-1', { organizationId: 'org-1', status: 'active', primaryDepartmentId: 'dep-1' })
  store.records.set('v2Organizations/org-1/employment_profile/user-2', { organizationId: 'org-1', status: 'active', primaryDepartmentId: 'dep-1' })
  store.records.set('v2Organizations/org-1/employment_profile/user-3', { organizationId: 'org-1', status: 'active', primaryDepartmentId: 'dep-2' })
  store.records.set('v2Organizations/org-1/team/team-1', { organizationId: 'org-1', status: 'active' })
  store.records.set('v2Organizations/org-1/department/dep-1', { organizationId: 'org-1', status: 'active' })
  store.records.set('v2Organizations/org-1/department/dep-2', { organizationId: 'org-1', status: 'active' })
}
const oneStep = [{ name: 'الخطوة الوحيدة', assigneeType: 'person' as const, assigneeUserId: 'user-2' }]
async function createTask(store: MemoryStore, id = 'task-1', overrides: Record<string, unknown> = {}) {
  const service = new TaskService(store, new Gate(), references(), departmentsPort())
  await service.create(metadata(), {
    id, projectId: 'project-1', workspaceId: 'workspace-1', steps: oneStep,
    title: '  مهمة   أساسية ', description: 'تفاصيل', priority: 'high', clientVisible: false,
    ...overrides,
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
  it('creates a tenant task, immediately in_progress on its single step, only for compatible active project/workspace references', async () => {
    const store = new MemoryStore(); seed(store)
    await createTask(store)
    expect(store.records.get('v2Organizations/org-1/task/task-1')).toMatchObject({
      organizationId: 'org-1', title: 'مهمة أساسية', status: 'in_progress', createdBy: 'user-1', version: 1,
      currentStepOrder: 0, stepCount: 1,
    })
    expect(store.records.get('v2Organizations/org-1/task_step/task-1-step-0')).toMatchObject({
      taskId: 'task-1', order: 0, assigneeType: 'person', assigneeUserId: 'user-2', status: 'in_progress',
    })
    expect(store.records.get('v2Organizations/org-1/task_assignment/task-1-assign-user-2')).toMatchObject({
      taskId: 'task-1', userId: 'user-2', status: 'accepted',
    })
    store.records.set('v2Organizations/org-1/workspace/other', { organizationId: 'org-1', status: 'active', projectId: 'project-2' })
    await expect(new TaskService(store, new Gate(), references(), departmentsPort()).create(metadata(), {
      id: 'task-2', projectId: 'project-1', workspaceId: 'other', title: 'مهمة متعارضة', steps: oneStep,
    })).rejects.toThrow('TASK_WORKSPACE_SCOPE_CONFLICT')
  })

  it('creates a task with no project at all (projects are optional)', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await service.create(metadata(), { id: 'task-standalone', title: 'مهمة مستقلة', steps: oneStep })
    expect(store.records.get('v2Organizations/org-1/task/task-standalone')).toMatchObject({ status: 'in_progress' })
    expect(store.records.get('v2Organizations/org-1/task/task-standalone')?.projectId).toBeUndefined()
  })

  it('rejects a task with zero steps', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await expect(service.create(metadata(), { id: 'task-empty', title: 'بلا خطوات', steps: [] }))
      .rejects.toThrow()
  })

  it('uses optimistic concurrency and makes completed tasks immutable', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    await service.update(metadata(), { taskId: 'task-1', expectedVersion: 1, title: 'عنوان جديد' })
    await expect(service.update(metadata(), { taskId: 'task-1', expectedVersion: 1, title: 'قديم' })).rejects.toThrow('VERSION_CONFLICT')
    await service.transition(metadata(), 'task-1', 2, 'completed')
    await expect(service.update(metadata(), { taskId: 'task-1', expectedVersion: 3, title: 'ممنوع' })).rejects.toThrow('TASK_TERMINAL_IMMUTABLE')
  })

  it('requires a reason for blocked and audited reopen', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    await expect(service.transition(metadata(), 'task-1', 1, 'blocked')).rejects.toThrow('TASK_BLOCK_REASON_REQUIRED')
    await service.transition(metadata(), 'task-1', 1, 'completed')
    await expect(service.reopen(metadata(), 'task-1', 2, 'قصير')).rejects.toThrow('INVALID_REOPEN_REASON')
    await service.reopen(metadata(), 'task-1', 2, 'إعادة فتح موثقة بسبب تعديل متطلبات العميل')
    expect(store.records.get('v2Organizations/org-1/task/task-1')).toMatchObject({ status: 'ready', completedAt: null, version: 3 })
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
    const service = new TaskService(store, new Gate(), references(1), departmentsPort())
    await expect(service.archive(metadata(), 'task-1', 1)).rejects.toThrow('TASK_HAS_ACTIVE_WORKFLOW')
  })

  it('is idempotent and emits one audit/outbox sequence per logical command', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    const command = metadata()
    const first = await service.create(command, { id: 'task-idem', title: 'مهمة ثابتة', steps: oneStep })
    const replay = await service.create(command, { id: 'task-idem', title: 'مهمة ثابتة', steps: oneStep })
    expect(replay).toEqual({ ...first, replayed: true })
    expect([...store.records.keys()].filter((path) => path.includes('/_auditEvents/'))).toHaveLength(1)
  })
})

describe('task step pipeline', () => {
  const twoPersonSteps = [
    { name: 'الخطوة الأولى', assigneeType: 'person' as const, assigneeUserId: 'user-2' },
    { name: 'الخطوة الثانية', assigneeType: 'person' as const, assigneeUserId: 'user-1' },
  ]

  it('scales to the simple single-step case: creating advances no further and completes the task on that one step', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await createTask(store)
    const result = await service.completeCurrentStep(metadata(principal('user-2')), 'task-1', 1)
    expect(result.result).toMatchObject({ taskStatus: 'completed' })
    expect(store.records.get('v2Organizations/org-1/task/task-1')).toMatchObject({ status: 'completed' })
    expect(store.records.get('v2Organizations/org-1/task_step/task-1-step-0')).toMatchObject({ status: 'done' })
  })

  it('auto-advances a multi-step task to the next assignee with no manager action, and denies completion by anyone else', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await service.create(metadata(), { id: 'task-multi', title: 'مهمة متعددة الخطوات', steps: twoPersonSteps })

    // Someone who is not the current step's assignee cannot complete it — the authorization resource
    // reflects that ineligibility (empty assigneeUserIds) even though the fake Gate never itself denies;
    // it's TaskService's own re-check inside the transaction that rejects the command.
    const gate = new Gate()
    const guardedService = new TaskService(store, gate, references(), departmentsPort())
    await expect(guardedService.completeCurrentStep(metadata(principal('user-1')), 'task-multi', 1)).rejects.toThrow('STEP_HOLDER_REQUIRED')
    expect(gate.requests.at(-1)?.resource).toMatchObject({ assigneeUserIds: [] })

    // The actual current-step holder (user-2, step 0) can complete it, auto-advancing to step 1 (user-1).
    const advanced = await service.completeCurrentStep(metadata(principal('user-2')), 'task-multi', 1)
    expect(advanced.result).toMatchObject({ currentStepOrder: 1, taskStatus: 'in_progress' })
    expect(store.records.get('v2Organizations/org-1/task_step/task-multi-step-0')).toMatchObject({ status: 'done' })
    expect(store.records.get('v2Organizations/org-1/task_step/task-multi-step-1')).toMatchObject({ status: 'in_progress' })

    // Now user-1 (the new current holder) can finish the task.
    const finished = await service.completeCurrentStep(metadata(principal('user-1')), 'task-multi', 2)
    expect(finished.result).toMatchObject({ taskStatus: 'completed' })
  })

  it('supports a department-assigned step: any active member of that department may act, and expands the department to a task_assignment row per member at creation', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort({ 'dep-1': ['user-1', 'user-2'] }))
    await service.create(metadata(), {
      id: 'task-dept', title: 'مهمة لقسم', steps: [{ name: 'مراجعة القسم', assigneeType: 'department', assigneeDepartmentId: 'dep-1' }],
    })
    expect(store.records.get('v2Organizations/org-1/task_assignment/task-dept-assign-user-1')).toMatchObject({ status: 'accepted' })
    expect(store.records.get('v2Organizations/org-1/task_assignment/task-dept-assign-user-2')).toMatchObject({ status: 'accepted' })
    // user-3 (dep-2, not a dep-1 member) cannot complete the department's step; user-1 (a dep-1 member) can,
    // even though the step names no specific person.
    await expect(service.completeCurrentStep(metadata(principal('user-3')), 'task-dept', 1)).rejects.toThrow('STEP_HOLDER_REQUIRED')
    const result = await service.completeCurrentStep(metadata(principal('user-1')), 'task-dept', 1)
    expect(result.result).toMatchObject({ taskStatus: 'completed' })
  })

  it('sends a step back to an earlier step with a required reason, visible in the step event history, resetting in-between steps', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await service.create(metadata(), {
      id: 'task-3step', title: 'مهمة ثلاثية', steps: [
        { name: 'أولى', assigneeType: 'person' as const, assigneeUserId: 'user-1' },
        { name: 'ثانية', assigneeType: 'person' as const, assigneeUserId: 'user-2' },
        { name: 'ثالثة', assigneeType: 'person' as const, assigneeUserId: 'user-3' },
      ],
    })
    await service.completeCurrentStep(metadata(principal('user-1')), 'task-3step', 1) // -> step 1 (user-2)
    await service.completeCurrentStep(metadata(principal('user-2')), 'task-3step', 2) // -> step 2 (user-3)

    await expect(service.sendBackStep(metadata(principal('user-3')), {
      taskId: 'task-3step', expectedVersion: 3, targetStepOrder: 0, reason: 'x',
    })).rejects.toThrow('SEND_BACK_REASON_REQUIRED') // too short

    const sentBack = await service.sendBackStep(metadata(principal('user-3')), {
      taskId: 'task-3step', expectedVersion: 3, targetStepOrder: 0, reason: 'نقص في المتطلبات الأساسية',
    })
    expect(sentBack.result).toMatchObject({ currentStepOrder: 0 })
    expect(store.records.get('v2Organizations/org-1/task/task-3step')).toMatchObject({ currentStepOrder: 0 })
    expect(store.records.get('v2Organizations/org-1/task_step/task-3step-step-2')).toMatchObject({ status: 'sent_back' })
    expect(store.records.get('v2Organizations/org-1/task_step/task-3step-step-1')).toMatchObject({ status: 'pending' })
    expect(store.records.get('v2Organizations/org-1/task_step/task-3step-step-0')).toMatchObject({ status: 'in_progress' })
    const event = [...store.records.entries()].find(([path, value]) => path.includes('/task_step_event/') && value.toStatus === 'sent_back')
    expect(event?.[1]).toMatchObject({ toStatus: 'sent_back', reason: 'نقص في المتطلبات الأساسية', targetStepOrder: 0 })

    // Send-back can only target a strictly earlier step, never forward or the same step.
    await expect(service.sendBackStep(metadata(principal('user-1')), {
      taskId: 'task-3step', expectedVersion: 4, targetStepOrder: 0, reason: 'محاولة غير صالحة للإرجاع',
    })).rejects.toThrow('SEND_BACK_MUST_TARGET_EARLIER_STEP')
  })

  it("stamps the department on task.create's authorization resource so a Department Lead's grant can be scoped to it", async () => {
    const store = new MemoryStore(); seed(store)
    const gate = new Gate()
    const service = new TaskService(store, gate, references(), departmentsPort())
    await service.create(metadata(), { id: 'task-scoped', title: 'مهمة قسم محدد', departmentId: 'dep-1', steps: oneStep })
    expect(gate.requests[0]).toMatchObject({ permission: 'task.create', resource: { departmentId: 'dep-1' } })
  })
})

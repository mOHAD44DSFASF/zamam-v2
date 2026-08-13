import { describe, expect, it } from 'vitest'
import {
  authorize, createDefaultRoles,
  type AuthorizationPrincipal, type AuthorizationRequest, type AuthorizationScope, type TrustedRoleAssignment,
} from '@zamam/authorization'
import { assertTaskStatusTransition, isTaskStalled, normalizeTaskTitle } from '@zamam/domain'
import { SERVER_TIMESTAMP, type AtomicStore, type AtomicTransaction, type StoredDocument } from '@zamam/firestore'
import {
  TaskService, type TaskAuthorizationGate, type TaskCommandMetadata,
  type TaskDepartmentMembersPort, type TaskReassignmentRolePort, type TaskReferencePort,
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
const reassignmentRoles = (input: { organizationRoleUserIds?: readonly string[]; departmentLeadAssignments?: Readonly<Record<string, readonly string[]>> } = {}): TaskReassignmentRolePort => ({
  hasActiveOrganizationManagerOrOwner: async (_organizationId, userId) => input.organizationRoleUserIds?.includes(userId) ?? false,
  hasActiveDepartmentLead: async (_organizationId, userId, departmentId) => input.departmentLeadAssignments?.[departmentId]?.includes(userId) ?? false,
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

describe('task step reassignment and waiting', () => {
  const currentStep = [{ name: 'المراجعة الحالية', assigneeType: 'person' as const, assigneeUserId: 'user-2' }]

  async function serviceWithTask(store: MemoryStore, roles = reassignmentRoles()) {
    const service = new TaskService(store, new Gate(), references(), departmentsPort({ 'dep-2': ['user-3'] }), undefined, roles)
    await service.create(metadata(principal('user-1')), { id: 'task-reassign', title: 'مهمة تحويل', steps: currentStep })
    return service
  }

  it('allows reassigning by each explicit authority category and rejects a principal in none of them', async () => {
    const cases: readonly { name: string; actor: string; roles?: TaskReassignmentRolePort }[] = [
      { name: 'current holder', actor: 'user-2' },
      { name: 'task creator', actor: 'user-1' },
      { name: 'organization Manager or Owner', actor: 'user-3', roles: reassignmentRoles({ organizationRoleUserIds: ['user-3'] }) },
      { name: 'Department Lead for the current holder department', actor: 'user-3', roles: reassignmentRoles({ departmentLeadAssignments: { 'dep-1': ['user-3'] } }) },
    ]
    for (const scenario of cases) {
      const store = new MemoryStore(); seed(store)
      const service = await serviceWithTask(store, scenario.roles ?? reassignmentRoles())
      await expect(service.reassignStep(metadata(principal(scenario.actor)), {
        taskId: 'task-reassign', expectedVersion: 1, assigneeType: 'department', assigneeDepartmentId: 'dep-2', reason: 'إعادة توزيع العمل',
      })).resolves.toMatchObject({ result: { version: 2 } })
      expect(store.records.get('v2Organizations/org-1/task_step/task-reassign-step-0')).toMatchObject({
        assigneeType: 'department', assigneeUserId: null, assigneeDepartmentId: 'dep-2', status: 'in_progress',
      })
    }

    const store = new MemoryStore(); seed(store)
    const service = await serviceWithTask(store)
    await expect(service.reassignStep(metadata(principal('user-3')), {
      taskId: 'task-reassign', expectedVersion: 1, assigneeType: 'person', assigneeUserId: 'user-1',
    })).rejects.toThrow('REASSIGN_NOT_ELIGIBLE')
  })

  it('resets the stalled timer and records the prior/new assignees when a current step is reassigned', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await serviceWithTask(store)
    store.records.set('v2Organizations/org-1/task/task-reassign', {
      ...store.records.get('v2Organizations/org-1/task/task-reassign')!, currentStepEnteredAt: '2026-08-01T00:00:00.000Z',
    })
    await service.reassignStep(metadata(principal('user-2')), {
      taskId: 'task-reassign', expectedVersion: 1, assigneeType: 'person', assigneeUserId: 'user-3',
    })
    expect(store.records.get('v2Organizations/org-1/task/task-reassign')).toMatchObject({
      currentStepAssigneeUserId: 'user-3', currentStepAssigneeDepartmentId: null, currentStepEnteredAt: SERVER_TIMESTAMP,
    })
    const event = [...store.records.entries()].find(([path, value]) => path.includes('/task_step_event/') && value.eventType === 'reassigned')
    expect(event?.[1]).toMatchObject({ previousAssigneeType: 'person', previousAssigneeUserId: 'user-2', newAssigneeType: 'person', newAssigneeUserId: 'user-3' })
  })

  it('requires the current holder to wait/resume, clears the waiting reason, and restarts the active stalled timer on resume', async () => {
    const store = new MemoryStore(); seed(store)
    const service = await serviceWithTask(store)
    store.records.set('v2Organizations/org-1/task/task-reassign', {
      ...store.records.get('v2Organizations/org-1/task/task-reassign')!, currentStepEnteredAt: '2026-08-01T00:00:00.000Z',
    })
    await service.setStepWaiting(metadata(principal('user-2')), 'task-reassign', 1, 'بانتظار رد العميل')
    expect(store.records.get('v2Organizations/org-1/task/task-reassign')).toMatchObject({
      currentStepStatus: 'waiting', currentStepWaitingReason: 'بانتظار رد العميل', currentStepEnteredAt: '2026-08-01T00:00:00.000Z',
    })
    await expect(service.completeCurrentStep(metadata(principal('user-2')), 'task-reassign', 2)).rejects.toThrow('INVALID_STEP_STATUS_TRANSITION')
    await service.resumeStep(metadata(principal('user-2')), 'task-reassign', 2)
    expect(store.records.get('v2Organizations/org-1/task/task-reassign')).toMatchObject({
      currentStepStatus: 'in_progress', currentStepWaitingReason: null, currentStepEnteredAt: SERVER_TIMESTAMP,
    })
    expect(store.records.get('v2Organizations/org-1/task_step/task-reassign-step-0')).toMatchObject({ status: 'in_progress', waitingReason: null })
    expect(isTaskStalled({ status: 'in_progress', currentStepStatus: 'waiting', currentStepEnteredAt: '2026-08-01T00:00:00.000Z' }, Date.parse('2026-08-08T00:00:00.000Z'))).toBe(false)
    expect(isTaskStalled({ status: 'in_progress', currentStepStatus: 'in_progress', currentStepEnteredAt: '2026-08-01T00:00:00.000Z' }, Date.parse('2026-08-08T00:00:00.000Z'))).toBe(true)
  })
})

// Regression coverage for a real bug found in review: reassignStep's coarse authorization pre-check used to
// call this.authorized(metadata, 'task.reassign') with NO taskId, so no resource was ever attached to the
// request. engine.ts's scopeMatches() treats every scope type other than 'organization'/'platform' as an
// automatic denial when no resource is present — so a DepartmentLead (scope 'department') or an ordinary
// Employee (scope 'self') was rejected by the coarse gate before ever reaching the correct four-way
// eligibility check below it, even though both are meant to be eligible. The mock `Gate` used everywhere
// else in this file always grants regardless of scope, so it cannot catch this class of bug — these tests
// exercise the real `authorize()` engine (same helper pattern as tests/authorization-engine.test.ts) instead.
describe('reassignStep authorization against the real engine (regression for the coarse-gate bug)', () => {
  const roles = createDefaultRoles('org-1')
  const allRoles = Object.values(roles)
  class RealGate {
    constructor(private readonly assignments: readonly TrustedRoleAssignment[]) {}
    async require(actor: AuthorizationPrincipal, request: AuthorizationRequest) {
      const decision = authorize(actor, request, allRoles, this.assignments)
      if (!decision.allowed) throw new Error(`AUTHORIZATION_DENIED:${decision.reason}`)
      return decision
    }
  }
  const roleAssignment = (userId: string, roleId: string, scope: AuthorizationScope): TrustedRoleAssignment => ({
    id: `assignment:${userId}:${roleId}`, organizationId: 'org-1', userId, roleId, scope, effect: 'grant', status: 'active',
  })

  it('allows a Department-Lead-scoped grant to reassign a step currently held by their department', async () => {
    const store = new MemoryStore(); seed(store)
    const setupService = new TaskService(store, new Gate(), references(), departmentsPort({ 'dep-1': ['user-2'] }))
    await setupService.create(metadata(principal('user-1')), {
      id: 'task-real-dept', title: 'مهمة تحويل حقيقية', steps: [{ name: 'الخطوة', assigneeType: 'department' as const, assigneeDepartmentId: 'dep-1' }],
    })
    const realService = new TaskService(
      store, new RealGate([roleAssignment('user-3', roles.DepartmentLead.id, { type: 'department', id: 'dep-1' })]),
      references(), departmentsPort({ 'dep-1': ['user-2'] }), undefined,
      reassignmentRoles({ departmentLeadAssignments: { 'dep-1': ['user-3'] } }),
    )
    await expect(realService.reassignStep(metadata(principal('user-3')), {
      taskId: 'task-real-dept', expectedVersion: 1, assigneeType: 'person', assigneeUserId: 'user-1',
    })).resolves.toMatchObject({ result: { version: 2 } })
  })

  it("allows a self-scoped Employee grant (the step's own current holder) to reassign it", async () => {
    const store = new MemoryStore(); seed(store)
    const setupService = new TaskService(store, new Gate(), references(), departmentsPort())
    await setupService.create(metadata(principal('user-1')), {
      id: 'task-real-self', title: 'مهمة تحويل حقيقية أخرى', steps: [{ name: 'الخطوة', assigneeType: 'person' as const, assigneeUserId: 'user-2' }],
    })
    const realService = new TaskService(
      store, new RealGate([roleAssignment('user-2', roles.Employee.id, { type: 'self', id: 'user-2' })]),
      references(), departmentsPort(),
    )
    await expect(realService.reassignStep(metadata(principal('user-2')), {
      taskId: 'task-real-self', expectedVersion: 1, assigneeType: 'person', assigneeUserId: 'user-3',
    })).resolves.toMatchObject({ result: { version: 2 } })
  })
})

describe('Area 4: per-step due dates and the denormalized current-step summary (stalled-task computation)', () => {
  const twoPersonSteps = [
    { name: 'الخطوة الأولى', assigneeType: 'person' as const, assigneeUserId: 'user-2', dueAt: '2026-08-10T00:00:00.000Z' },
    { name: 'الخطوة الثانية', assigneeType: 'person' as const, assigneeUserId: 'user-1' },
  ]

  it('denormalizes the first step\'s name/assignee/dueAt onto the task doc at creation, for stalled-task queries that read the task alone (no per-task step fetch)', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await service.create(metadata(), { id: 'task-denorm', title: 'مهمة بموعد خطوة', steps: twoPersonSteps })
    expect(store.records.get('v2Organizations/org-1/task/task-denorm')).toMatchObject({
      currentStepName: 'الخطوة الأولى', currentStepAssigneeType: 'person', currentStepAssigneeUserId: 'user-2',
      currentStepDueAt: '2026-08-10T00:00:00.000Z',
    })
    expect(store.records.get('v2Organizations/org-1/task_step/task-denorm-step-0')).toMatchObject({ dueAt: '2026-08-10T00:00:00.000Z' })
  })

  it('keeps the denormalized current-step summary in sync when completeCurrentStep() advances to a step with no due date', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await service.create(metadata(), { id: 'task-advance', title: 'مهمة تقدم', steps: twoPersonSteps })
    await service.completeCurrentStep(metadata(principal('user-2')), 'task-advance', 1)
    expect(store.records.get('v2Organizations/org-1/task/task-advance')).toMatchObject({
      currentStepName: 'الخطوة الثانية', currentStepAssigneeUserId: 'user-1', currentStepDueAt: null,
    })
  })

  it('keeps the denormalized current-step summary in sync when sendBackStep() moves back to an earlier step', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await service.create(metadata(), { id: 'task-back', title: 'مهمة إرجاع', steps: twoPersonSteps })
    await service.completeCurrentStep(metadata(principal('user-2')), 'task-back', 1)
    await service.sendBackStep(metadata(principal('user-1')), {
      taskId: 'task-back', expectedVersion: 2, targetStepOrder: 0, reason: 'نقص في المتطلبات الأساسية',
    })
    expect(store.records.get('v2Organizations/org-1/task/task-back')).toMatchObject({
      currentStepName: 'الخطوة الأولى', currentStepAssigneeUserId: 'user-2', currentStepDueAt: '2026-08-10T00:00:00.000Z',
    })
  })

  it('setStepDueDate() updates the step and, only when it is the CURRENT step, the task doc\'s denormalized currentStepDueAt too', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new TaskService(store, new Gate(), references(), departmentsPort())
    await service.create(metadata(), { id: 'task-setdue', title: 'مهمة تعديل موعد', steps: twoPersonSteps })

    // Step 1 (order 1) is NOT current — editing its due date must not touch the task's currentStepDueAt.
    await service.setStepDueDate(metadata(), { taskId: 'task-setdue', stepOrder: 1, expectedVersion: 1, dueAt: '2026-09-01T00:00:00.000Z' })
    expect(store.records.get('v2Organizations/org-1/task_step/task-setdue-step-1')).toMatchObject({ dueAt: '2026-09-01T00:00:00.000Z' })
    expect(store.records.get('v2Organizations/org-1/task/task-setdue')).toMatchObject({ currentStepDueAt: '2026-08-10T00:00:00.000Z' })

    // Step 0 IS current — editing (or clearing) its due date updates the task's denormalized field too.
    await service.setStepDueDate(metadata(), { taskId: 'task-setdue', stepOrder: 0, expectedVersion: 1, dueAt: null })
    expect(store.records.get('v2Organizations/org-1/task_step/task-setdue-step-0')).toMatchObject({ dueAt: null })
    expect(store.records.get('v2Organizations/org-1/task/task-setdue')).toMatchObject({ currentStepDueAt: null })
  })
})

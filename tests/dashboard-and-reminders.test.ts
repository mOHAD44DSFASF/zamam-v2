import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationPrincipal } from '@zamam/authorization'
import { STALLED_STEP_DEFAULT_THRESHOLD_DAYS, buildWhatsappLink, buildWhatsappReminderMessage, isTaskStalled } from '@zamam/domain'
import type { Deps } from '../services/functions/src/api/deps'
import { createDashboardHandlers, isCurrentHolder, summarize, toRow } from '../services/functions/src/api/handlers/dashboard'

describe('Area 4: isTaskStalled (server-side stalled-task derivation)', () => {
  const now = Date.parse('2026-08-15T00:00:00.000Z')

  it('is never stalled unless the task is currently in_progress', () => {
    expect(isTaskStalled({ status: 'blocked', currentStepDueAt: '2026-01-01T00:00:00.000Z' }, now)).toBe(false)
    expect(isTaskStalled({ status: 'completed', currentStepDueAt: '2026-01-01T00:00:00.000Z' }, now)).toBe(false)
  })

  it('with a due date set, stalled iff now is past it — the 3-day default threshold does not apply', () => {
    expect(isTaskStalled({ status: 'in_progress', currentStepDueAt: '2026-08-14T00:00:00.000Z' }, now)).toBe(true)
    expect(isTaskStalled({ status: 'in_progress', currentStepDueAt: '2026-08-16T00:00:00.000Z' }, now)).toBe(false)
  })

  it('with no due date, falls back to the default 3-day threshold since the step became current', () => {
    expect(STALLED_STEP_DEFAULT_THRESHOLD_DAYS).toBe(3)
    const fourDaysAgo = new Date(now - 4 * 86_400_000).toISOString()
    const twoDaysAgo = new Date(now - 2 * 86_400_000).toISOString()
    expect(isTaskStalled({ status: 'in_progress', currentStepEnteredAt: fourDaysAgo }, now)).toBe(true)
    expect(isTaskStalled({ status: 'in_progress', currentStepEnteredAt: twoDaysAgo }, now)).toBe(false)
  })

  it('is not stalled if neither a due date nor an entered-at timestamp is known', () => {
    expect(isTaskStalled({ status: 'in_progress' }, now)).toBe(false)
  })

  it('respects a custom threshold override (the owner can ask to change the 3-day default later)', () => {
    const oneDayAgo = new Date(now - 86_400_000).toISOString()
    expect(isTaskStalled({ status: 'in_progress', currentStepEnteredAt: oneDayAgo }, now, 0.5)).toBe(true)
  })
})

describe('Area 5: WhatsApp wa.me link generation', () => {
  it('builds a correctly-encoded wa.me link, stripping the leading + from the phone', () => {
    const message = buildWhatsappReminderMessage({
      taskTitle: 'مراجعة العقد', stepName: 'الموافقة النهائية', priority: 'urgent',
    })
    const link = buildWhatsappLink('+966501234567', message)
    expect(link.startsWith('https://wa.me/966501234567?text=')).toBe(true)
    const decoded = decodeURIComponent(link.split('?text=')[1]!)
    expect(decoded).toBe(message)
    expect(decoded).toContain('مراجعة العقد')
    expect(decoded).toContain('عاجل') // urgent -> عاجل
  })

  it('rejects a phone number that is not digits-with-country-code shaped', () => {
    expect(() => buildWhatsappLink('not-a-phone', 'hello')).toThrow('INVALID_WHATSAPP_PHONE')
  })

  it('message template includes task title, project, step, priority, due date, and description, newline-formatted', () => {
    const message = buildWhatsappReminderMessage({
      taskTitle: 'إطلاق الحملة', projectName: 'مشروع التسويق', stepName: 'مراجعة التصميم',
      priority: 'high', dueAt: '2026-08-20T00:00:00.000Z', description: 'يرجى المراجعة قبل الموعد.',
    })
    const lines = message.split('\n')
    expect(lines[0]).toContain('إطلاق الحملة')
    expect(message).toContain('مشروع التسويق')
    expect(message).toContain('مراجعة التصميم')
    expect(message).toContain('مهم') // high -> مهم
    expect(message).toContain('2026-08-20')
    expect(message).toContain('يرجى المراجعة قبل الموعد.')
  })

  it('maps low/medium priority to the same "عادي" label as the product-facing 3-tier scale', () => {
    expect(buildWhatsappReminderMessage({ taskTitle: 't', stepName: 's', priority: 'low' })).toContain('عادي')
    expect(buildWhatsappReminderMessage({ taskTitle: 't', stepName: 's', priority: 'medium' })).toContain('عادي')
  })
})

describe('Area 3: dashboard row-shaping helpers', () => {
  const names = { assignee: new Map([['user-2', 'محمد']]), phones: new Map([['user-2', '+966501234567']]), projects: new Map() }
  const now = Date.parse('2026-08-15T00:00:00.000Z')

  it('isCurrentHolder: person step matches by exact userId; department step matches by the caller\'s own department', () => {
    const personTask = { currentStepAssigneeType: 'person', currentStepAssigneeUserId: 'user-2' }
    expect(isCurrentHolder(personTask, 'user-2', null)).toBe(true)
    expect(isCurrentHolder(personTask, 'user-3', null)).toBe(false)
    const deptTask = { currentStepAssigneeType: 'department', currentStepAssigneeDepartmentId: 'dep-1' }
    expect(isCurrentHolder(deptTask, 'user-2', 'dep-1')).toBe(true)
    expect(isCurrentHolder(deptTask, 'user-2', 'dep-2')).toBe(false)
    expect(isCurrentHolder(deptTask, 'user-2', null)).toBe(false)
  })

  it('toRow: resolves the assignee name/whatsapp and flags stalled per isTaskStalled', () => {
    const row = toRow({
      id: 'task-1', title: 'مهمة', priority: 'urgent', status: 'in_progress', version: 2,
      currentStepOrder: 0, currentStepName: 'الخطوة الأولى', currentStepAssigneeType: 'person',
      currentStepAssigneeUserId: 'user-2', currentStepDueAt: '2026-08-10T00:00:00.000Z',
    }, now, names)
    expect(row).toMatchObject({
      taskId: 'task-1', currentStepAssigneeName: 'محمد', currentStepAssigneeWhatsapp: '+966501234567', stalled: true,
    })
  })

  it('summarize: counts by status and priority', () => {
    const summary = summarize([
      { status: 'in_progress', priority: 'urgent' }, { status: 'in_progress', priority: 'medium' }, { status: 'blocked', priority: 'high' },
    ])
    expect(summary).toEqual({ byStatus: { in_progress: 2, blocked: 1 }, byPriority: { urgent: 1, medium: 1, high: 1 }, total: 3 })
  })
})

describe('Area 3: /v1/dashboard/query scoping per role', () => {
  const orgId = 'org-1'
  const principal = (userId: string): AuthorizationPrincipal => ({
    userId, authenticated: true, tokenFresh: true, accountStatus: 'active', employmentStatus: 'active',
    organizationId: orgId, membershipStatus: 'active', principalType: 'member', clientAccountIds: [],
    stepUpSatisfied: true, mfaSatisfied: true,
  })

  const activeTask = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, title: `Task ${id}`, priority: 'medium', status: 'in_progress', version: 1,
    currentStepOrder: 0, currentStepName: 'Step', currentStepAssigneeType: 'person',
    currentStepAssigneeUserId: 'employee-1', currentStepDueAt: null, currentStepEnteredAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  })

  function depsFor(opts: {
    roleAssignment: { scopeType: string; scopeId: string } | null
    employment?: { primaryDepartmentId?: string } | null
    tasks?: Record<string, unknown>[]
    departmentMembers?: Record<string, unknown>[]
    taskAssignments?: Record<string, unknown>[]
  }): Deps {
    const docs: Record<string, Record<string, unknown> | undefined> = {
      [`v2Organizations/${orgId}/employment_profile/employee-1`]: opts.employment ?? undefined,
    }
    for (const task of opts.tasks ?? []) docs[`v2Organizations/${orgId}/task/${task.id}`] = task
    const firestore = {
      doc: (path: string) => ({ get: async () => ({ exists: Boolean(docs[path]), data: () => docs[path] }) }),
    }
    const queries = {
      list: vi.fn(async (_collectionPath: string, query: { entityKind: string; filters?: readonly { field: string; value: unknown }[] }) => {
        if (query.entityKind === 'role_assignment') return { items: opts.roleAssignment ? [opts.roleAssignment] : [], nextCursor: null }
        if (query.entityKind === 'task') {
          const departmentFilter = query.filters?.find((f) => f.field === 'departmentId')
          const statusFilter = query.filters?.find((f) => f.field === 'status')
          const items = (opts.tasks ?? [])
            .filter((t) => !departmentFilter || t.departmentId === departmentFilter.value)
            .filter((t) => !statusFilter || (statusFilter.value as readonly string[]).includes(t.status as string))
          return { items, nextCursor: null }
        }
        if (query.entityKind === 'employment_profile') return { items: opts.departmentMembers ?? [], nextCursor: null }
        if (query.entityKind === 'task_assignment') return { items: opts.taskAssignments ?? [], nextCursor: null }
        return { items: [], nextCursor: null }
      }),
    }
    const authorization = { evaluate: vi.fn(async () => ({ allowed: true })) }
    return { firestore, queries, authorization, now: () => new Date('2026-08-15T00:00:00.000Z') } as unknown as Deps
  }

  it('Owner/Manager (organization scope): sees every active task across the whole organization', async () => {
    const deps = depsFor({
      roleAssignment: { scopeType: 'organization', scopeId: orgId },
      tasks: [activeTask('t1'), activeTask('t2', { status: 'completed' })], // completed excluded by ACTIVE_TASK_STATUSES
    })
    const handlers = createDashboardHandlers(deps)
    const result = await handlers['/v1/dashboard/query']!(
      { organizationId: orgId, principal: principal('employee-1'), correlationId: 'c', idempotencyKey: 'i', fingerprint: 'f' }, {},
    ) as { scope: string; tasks: readonly { taskId: string }[] }
    expect(result.scope).toBe('organization')
    expect(result.tasks.map((t) => t.taskId)).toEqual(['t1'])
  })

  it('Department Lead (department scope): sees tasks owned by their department or assigned to their department\'s members, not org-wide', async () => {
    const deps = depsFor({
      roleAssignment: { scopeType: 'department', scopeId: 'dep-1' },
      employment: { primaryDepartmentId: 'dep-1' },
      departmentMembers: [{ userId: 'member-a' }, { userId: 'member-b' }],
      taskAssignments: [{ taskId: 'assigned-task', status: 'accepted' }],
      tasks: [
        activeTask('owned-task', { departmentId: 'dep-1' }),
        activeTask('assigned-task', { departmentId: 'dep-2' }),
        activeTask('other-dept-task', { departmentId: 'dep-2' }),
      ],
    })
    const handlers = createDashboardHandlers(deps)
    const result = await handlers['/v1/dashboard/query']!(
      { organizationId: orgId, principal: principal('employee-1'), correlationId: 'c', idempotencyKey: 'i', fingerprint: 'f' }, {},
    ) as { scope: string; departmentId: string; tasks: readonly { taskId: string }[] }
    expect(result.scope).toBe('department')
    expect(result.departmentId).toBe('dep-1')
    const ids = result.tasks.map((t) => t.taskId).sort()
    expect(ids).toEqual(['assigned-task', 'owned-task'])
    expect(ids).not.toContain('other-dept-task')
  })

  it('Employee (self scope): splits into current (they hold the current step) vs upcoming (assigned but not current)', async () => {
    const deps = depsFor({
      roleAssignment: { scopeType: 'self', scopeId: 'employee-1' },
      employment: { primaryDepartmentId: 'dep-1' },
      taskAssignments: [{ taskId: 'current-task', status: 'accepted' }, { taskId: 'upcoming-task', status: 'accepted' }],
      tasks: [
        activeTask('current-task', { currentStepAssigneeUserId: 'employee-1' }),
        activeTask('upcoming-task', { currentStepAssigneeUserId: 'someone-else' }),
      ],
    })
    const handlers = createDashboardHandlers(deps)
    const result = await handlers['/v1/dashboard/query']!(
      { organizationId: orgId, principal: principal('employee-1'), correlationId: 'c', idempotencyKey: 'i', fingerprint: 'f' }, {},
    ) as { scope: string; currentTasks: readonly { taskId: string }[]; upcomingTasks: readonly { taskId: string }[] }
    expect(result.scope).toBe('employee')
    expect(result.currentTasks.map((t) => t.taskId)).toEqual(['current-task'])
    expect(result.upcomingTasks.map((t) => t.taskId)).toEqual(['upcoming-task'])
  })

  it('falls back to employee scope when there is no role_assignment doc at all (never silently grants org-wide visibility)', async () => {
    const deps = depsFor({ roleAssignment: null, taskAssignments: [], tasks: [] })
    const handlers = createDashboardHandlers(deps)
    const result = await handlers['/v1/dashboard/query']!(
      { organizationId: orgId, principal: principal('employee-1'), correlationId: 'c', idempotencyKey: 'i', fingerprint: 'f' }, {},
    ) as { scope: string }
    expect(result.scope).toBe('employee')
  })
})

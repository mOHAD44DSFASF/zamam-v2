import { isTaskStalled } from '@zamam/domain'
import { tenantDocumentPath } from '@zamam/firestore'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, readDoc, orgPath, resolveNames } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'

const ACTIVE_TASK_STATUSES = ['ready', 'in_progress', 'blocked', 'in_review', 'approved'] as const

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function activeDepartmentMemberIds(deps: Deps, organizationId: string, departmentId: string) {
  const page = await listQuery(deps, organizationId, 'employment_profile', {
    filters: [
      { field: 'primaryDepartmentId', operator: '==', value: departmentId },
      { field: 'status', operator: '==', value: 'active' },
    ],
    orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 200,
  })
  return page.items.map((item) => String(item.userId))
}

async function tasksByAssigneeUserIds(deps: Deps, organizationId: string, userIds: readonly string[]) {
  const unique = [...new Set(userIds)]
  if (!unique.length) return []
  const groups = await Promise.all(chunk(unique, 10).map((group) => listQuery(deps, organizationId, 'task_assignment', {
    filters: [
      { field: 'userId', operator: 'in', value: group },
      { field: 'status', operator: '==', value: 'accepted' },
    ],
    orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
  })))
  return [...new Set(groups.flatMap((page) => page.items.map((item) => String(item.taskId))))]
}

async function getTasksByIds(deps: Deps, organizationId: string, taskIds: readonly string[]) {
  if (!taskIds.length) return []
  const snapshots = await Promise.all(taskIds.map((id) => deps.firestore.doc(tenantDocumentPath(organizationId, 'task', id)).get()))
  return snapshots.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }) as Record<string, unknown>)
}

/** Person steps: exact userId match. Department steps: caller's own primary department matches the step's
 * — the same eligibility rule TaskService.completeCurrentStep()/sendBackStep() enforce, reused here purely
 * for the dashboard's "current vs upcoming" split (read-only, no authorization decision made here).
 * Exported for direct unit testing (tests/dashboard-query.test.ts) alongside toRow()/summarize(). */
export const isCurrentHolder = (task: Record<string, unknown>, userId: string, callerDepartmentId: string | null) =>
  task.currentStepAssigneeType === 'person'
    ? task.currentStepAssigneeUserId === userId
    : Boolean(callerDepartmentId) && task.currentStepAssigneeDepartmentId === callerDepartmentId

export function toRow(task: Record<string, unknown>, now: number, names: {
  assignee: Map<string, string | null>; phones: Map<string, string | null>; projects: Map<string, string | null>
}) {
  const assigneeUserId = typeof task.currentStepAssigneeUserId === 'string' ? task.currentStepAssigneeUserId : undefined
  return {
    taskId: String(task.id ?? ''), title: String(task.title ?? ''),
    priority: String(task.priority ?? 'medium'), status: String(task.status ?? ''),
    version: Number(task.version ?? 1),
    ...(typeof task.projectId === 'string' ? { projectId: task.projectId, projectName: names.projects.get(task.projectId) ?? null } : {}),
    ...(typeof task.departmentId === 'string' ? { departmentId: task.departmentId } : {}),
    currentStepOrder: Number(task.currentStepOrder ?? 0),
    currentStepName: String(task.currentStepName ?? ''),
    currentStepDueAt: (task.currentStepDueAt as string | null) ?? null,
    currentStepAssigneeType: task.currentStepAssigneeType === 'department' ? 'department' as const : 'person' as const,
    ...(assigneeUserId ? {
      currentStepAssigneeUserId: assigneeUserId,
      currentStepAssigneeName: names.assignee.get(assigneeUserId) ?? null,
      currentStepAssigneeWhatsapp: names.phones.get(assigneeUserId) ?? null,
    } : {}),
    ...(typeof task.currentStepAssigneeDepartmentId === 'string' ? { currentStepAssigneeDepartmentId: task.currentStepAssigneeDepartmentId } : {}),
    stalled: isTaskStalled({
      status: task.status as never, currentStepDueAt: task.currentStepDueAt as string | null, currentStepEnteredAt: task.currentStepEnteredAt as string | null,
    }, now),
  }
}

export function summarize(tasks: readonly Record<string, unknown>[]) {
  const byStatus: Record<string, number> = {}
  const byPriority: Record<string, number> = {}
  for (const task of tasks) {
    const status = String(task.status ?? '')
    const priority = String(task.priority ?? 'medium')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    byPriority[priority] = (byPriority[priority] ?? 0) + 1
  }
  return { byStatus, byPriority, total: tasks.length }
}

export function createDashboardHandlers(deps: Deps): HandlerRegistry {
  return {
    '/v1/dashboard/query': async (context) => {
      const userId = context.principal.userId
      const now = deps.now().getTime()
      // role_assignment doc ids aren't uniform across every writer (EmployeeService.invite()/createDirect()
      // use `role-${userId}`, BootstrapOwnerService uses `owner-${userId}`) — query by the userId field
      // instead of guessing the id, same as every other cross-cutting lookup in this codebase.
      const [roleAssignmentPage, employment] = await Promise.all([
        listQuery(deps, context.organizationId, 'role_assignment', {
          filters: [{ field: 'userId', operator: '==', value: userId }, { field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
        }),
        readDoc(deps.firestore, orgPath(context.organizationId, 'employment_profile', userId)),
      ])
      const roleAssignment = roleAssignmentPage.items[0] as Record<string, unknown> | undefined
      const callerDepartmentId = employment && typeof employment.primaryDepartmentId === 'string' ? employment.primaryDepartmentId : null
      const scopeType = roleAssignment?.scopeType === 'organization' ? 'organization' as const
        : roleAssignment?.scopeType === 'department' ? 'department' as const
          : 'employee' as const
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        createTask: 'task.create', createMember: 'user.invite',
      })

      let tasks: Record<string, unknown>[]
      let currentTasks: Record<string, unknown>[] = []
      let upcomingTasks: Record<string, unknown>[] = []

      if (scopeType === 'organization') {
        const page = await listQuery(deps, context.organizationId, 'task', {
          filters: [{ field: 'status', operator: 'in', value: [...ACTIVE_TASK_STATUSES] }],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
        })
        tasks = page.items as Record<string, unknown>[]
      } else if (scopeType === 'department') {
        const departmentId = String(roleAssignment!.scopeId)
        const memberIds = await activeDepartmentMemberIds(deps, context.organizationId, departmentId)
        const [assignedTaskIds, ownedPage] = await Promise.all([
          tasksByAssigneeUserIds(deps, context.organizationId, memberIds),
          listQuery(deps, context.organizationId, 'task', {
            filters: [
              { field: 'departmentId', operator: '==', value: departmentId },
              { field: 'status', operator: 'in', value: [...ACTIVE_TASK_STATUSES] },
            ],
            orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
          }),
        ])
        const byAssignment = await getTasksByIds(deps, context.organizationId, assignedTaskIds)
        const merged = new Map<string, Record<string, unknown>>()
        for (const task of [...ownedPage.items as Record<string, unknown>[], ...byAssignment]) merged.set(String(task.id), task)
        tasks = [...merged.values()].filter((task) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(String(task.status)))
      } else {
        const taskIds = await tasksByAssigneeUserIds(deps, context.organizationId, [userId])
        const all = (await getTasksByIds(deps, context.organizationId, taskIds))
          .filter((task) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(String(task.status)))
        currentTasks = all.filter((task) => isCurrentHolder(task, userId, callerDepartmentId))
        upcomingTasks = all.filter((task) => !isCurrentHolder(task, userId, callerDepartmentId))
        tasks = all
      }

      const assigneeUserIds = tasks.map((t) => t.currentStepAssigneeUserId).filter((v): v is string => typeof v === 'string')
      const projectIds = tasks.map((t) => t.projectId).filter((v): v is string => typeof v === 'string')
      const [assigneeNames, assigneePhones, projectNames] = await Promise.all([
        resolveNames(deps, context.organizationId, 'user_profile', assigneeUserIds, 'displayName'),
        resolveNames(deps, context.organizationId, 'user_profile', assigneeUserIds, 'whatsappPhone'),
        resolveNames(deps, context.organizationId, 'project', projectIds, 'title'),
      ])
      const names = { assignee: assigneeNames, phones: assigneePhones, projects: projectNames }
      const rows = tasks.map((task) => toRow(task, now, names))
      const stalledRows = rows.filter((row) => row.stalled)

      return {
        scope: scopeType,
        ...(scopeType === 'department' ? { departmentId: String(roleAssignment!.scopeId) } : {}),
        summary: { ...summarize(tasks), stalledCount: stalledRows.length },
        stalled: stalledRows,
        tasks: rows,
        ...(scopeType === 'employee' ? {
          currentTasks: currentTasks.map((task) => toRow(task, now, names)),
          upcomingTasks: upcomingTasks.map((task) => toRow(task, now, names)),
        } : {}),
        capabilities,
      }
    },
  }
}

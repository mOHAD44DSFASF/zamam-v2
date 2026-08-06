import { tenantDocumentPath } from '@zamam/firestore'
import { TaskService, type TaskDepartmentMembersPort, type TaskReferencePort } from '../../task/service.js'
import { TaskQueryService, SavedTaskViewService, type TaskQueryStore, type TaskSearchPort, type TaskViewScope } from '../../task/query.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, resolveNames } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createReferencePort(deps: Deps): TaskReferencePort {
  return {
    async activeWorkflowInstanceCount(organizationId, taskId) {
      const page = await listQuery(deps, organizationId, 'task_workflow_instance', {
        filters: [{ field: 'taskId', operator: '==', value: taskId }, { field: 'status', operator: '==', value: 'active' }],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
      })
      return page.items.length
    },
  }
}

function createDepartmentMembersPort(deps: Deps): TaskDepartmentMembersPort {
  return {
    async activeMembers(organizationId, departmentId) {
      const page = await listQuery(deps, organizationId, 'employment_profile', {
        filters: [
          { field: 'primaryDepartmentId', operator: '==', value: departmentId },
          { field: 'status', operator: '==', value: 'active' },
        ],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
      })
      return page.items.map((item) => String(item.userId))
    },
  }
}

function createQueryStore(deps: Deps): TaskQueryStore {
  return {
    list: (query) => deps.queries.list(`v2Organizations/${query.organizationId}/${query.entityKind}`, query),
    async getTasksByIds(organizationId, taskIds) {
      if (!taskIds.length) return []
      const snapshots = await Promise.all(taskIds.map((id) => deps.firestore.doc(tenantDocumentPath(organizationId, 'task', id)).get()))
      return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    },
  }
}

const searchPort: TaskSearchPort = { async searchTaskIds() { throw new Error('SEARCH_NOT_CONFIGURED') } }

const stepRow = (raw: Record<string, unknown>) => ({
  id: String(raw.id ?? ''), order: Number(raw.order ?? 0), name: String(raw.name ?? ''),
  assigneeType: raw.assigneeType === 'department' ? 'department' as const : 'person' as const,
  ...(typeof raw.assigneeUserId === 'string' ? { assigneeUserId: raw.assigneeUserId } : {}),
  ...(typeof raw.assigneeDepartmentId === 'string' ? { assigneeDepartmentId: raw.assigneeDepartmentId } : {}),
  ...(typeof raw.driveLink === 'string' ? { driveLink: raw.driveLink } : {}),
  status: String(raw.status ?? 'pending'), version: Number(raw.version ?? 1),
})

export function createTaskHandlers(deps: Deps): HandlerRegistry {
  const service = new TaskService(deps.store, deps.authorization, createReferencePort(deps), createDepartmentMembersPort(deps))
  const queryService = new TaskQueryService(createQueryStore(deps), deps.authorization, searchPort)
  const savedViews = new SavedTaskViewService(deps.store, deps.authorization)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.create>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/tasks/query': async (context, input) => {
      const scopeInput = input.scope as { type?: string; userId?: string; teamId?: string; projectId?: string } | undefined
      // No explicit scope from the frontend: default to whatever the caller can actually see rather than
      // always requesting organization-wide (task.view_all) — an Employee/DepartmentLead only has task.view
      // at 'self' scope (see EmployeeService.invite()'s role-assignment scoping), so blindly defaulting to
      // organization scope denied them entirely instead of returning their own assigned tasks.
      const canViewAll = !scopeInput?.type && (await deps.authorization.evaluate(
        context.principal, { permission: 'task.view_all', organizationId: context.organizationId },
      )).allowed
      const scope: TaskViewScope = scopeInput?.type === 'self'
        ? { type: 'self', userId: context.principal.userId }
        : scopeInput?.type === 'team' && typeof scopeInput.teamId === 'string'
          ? { type: 'team', teamId: scopeInput.teamId }
          : scopeInput?.type === 'project' && typeof scopeInput.projectId === 'string'
            ? { type: 'project', projectId: scopeInput.projectId }
            : !scopeInput?.type && !canViewAll
              ? { type: 'self', userId: context.principal.userId }
              : { type: 'organization' }
      const page = await queryService.list(context.principal, {
        organizationId: context.organizationId, scope, filters: input.filters,
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      // Pick-lists for the create form: active projects, workspaces, departments, and members (for the step
      // assignee picker — person or department).
      const [projectPage, workspacePage, departmentPage, membershipPage] = await Promise.all([
        listQuery(deps, context.organizationId, 'project', {
          filters: [{ field: 'status', operator: 'in', value: ['draft', 'planned', 'active', 'on_hold'] }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
        listQuery(deps, context.organizationId, 'workspace', {
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
        listQuery(deps, context.organizationId, 'department', {
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
        listQuery(deps, context.organizationId, 'organization_membership', {
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
        }),
      ])
      const projects = projectPage.items.map((p) => ({ id: String(p.id), name: String(p.name) }))
      const workspaces = workspacePage.items.map((w) => ({ id: String(w.id), name: String(w.name), ...(typeof w.projectId === 'string' ? { projectId: w.projectId } : {}) }))
      const departments = departmentPage.items.map((d) => ({ id: String(d.id), name: String(d.name) }))
      const memberNames = await resolveNames(deps, context.organizationId, 'user_profile', membershipPage.items.map((m) => String(m.userId)), 'displayName')
      const members = membershipPage.items.map((m) => ({ userId: String(m.userId), displayName: memberNames.get(String(m.userId)) ?? String(m.userId) }))
      // Step names/drive links live in the task_step subcollection, not on the task doc — resolve them for
      // every returned task in one batch pass so the pipeline view has what it needs without N+1 calls.
      const rows = page.items as Record<string, unknown>[]
      const taskIds = rows.map((r) => String(r.id ?? '')).filter(Boolean)
      const stepsByTask = new Map<string, ReturnType<typeof stepRow>[]>()
      if (taskIds.length) {
        const stepPages = await Promise.all(taskIds.map((taskId) => listQuery(deps, context.organizationId, 'task_step', {
          filters: [{ field: 'taskId', operator: '==', value: taskId }],
          orderBy: [{ field: 'order', direction: 'asc' }], limit: 20,
        })))
        stepPages.forEach((stepPage, index) => {
          stepsByTask.set(taskIds[index]!, stepPage.items.map((item) => stepRow(item as Record<string, unknown>)))
        })
      }
      const items = rows.map((r) => ({ ...r, steps: stepsByTask.get(String(r.id ?? '')) ?? [] }))
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        create: 'task.create', update: 'task.update', transition: 'task.transition',
        assign: 'task.assign', reopen: 'task.reopen', archive: 'task.archive', saveView: 'saved_view.create',
      })
      return { ...page, items, projects, workspaces, departments, members, capabilities }
    },
    '/v1/tasks/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), title: requireString(input, 'title'),
      steps: (Array.isArray(input.steps) ? input.steps : []) as Parameters<typeof service.create>[1]['steps'],
      ...(typeof input.projectId === 'string' ? { projectId: input.projectId } : {}),
      ...(typeof input.workspaceId === 'string' ? { workspaceId: input.workspaceId } : {}),
      ...(typeof input.parentTaskId === 'string' ? { parentTaskId: input.parentTaskId } : {}),
      ...(typeof input.departmentId === 'string' ? { departmentId: input.departmentId } : {}),
      ...(typeof input.description === 'string' ? { description: input.description } : {}),
      ...(typeof input.priority === 'string' ? { priority: input.priority as 'low' | 'medium' | 'high' | 'urgent' } : {}),
      ...(typeof input.dueAt === 'string' ? { dueAt: input.dueAt } : {}),
      ...(typeof input.driveLink === 'string' ? { driveLink: input.driveLink } : {}),
      clientVisible: typeof input.clientVisible === 'boolean' ? input.clientVisible : false,
    }),
    '/v1/tasks/update': (context, input) => service.update(metadata(context), {
      taskId: requireString(input, 'taskId'), expectedVersion: requireNumber(input, 'expectedVersion'),
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      ...(typeof input.description === 'string' ? { description: input.description } : {}),
      ...(typeof input.priority === 'string' ? { priority: input.priority as 'low' | 'medium' | 'high' | 'urgent' } : {}),
      ...(input.dueAt === null || typeof input.dueAt === 'string' ? { dueAt: input.dueAt as string | null } : {}),
      ...(typeof input.clientVisible === 'boolean' ? { clientVisible: input.clientVisible } : {}),
    }),
    '/v1/tasks/complete-step': (context, input) => service.completeCurrentStep(
      metadata(context), requireString(input, 'taskId'), requireNumber(input, 'expectedVersion'),
    ),
    '/v1/tasks/send-back-step': (context, input) => service.sendBackStep(metadata(context), {
      taskId: requireString(input, 'taskId'), expectedVersion: requireNumber(input, 'expectedVersion'),
      targetStepOrder: requireNumber(input, 'targetStepOrder'), reason: requireString(input, 'reason'),
    }),
    '/v1/task-views/create': (context, input) => savedViews.create(metadata(context), {
      id: requireString(input, 'id'), name: requireString(input, 'name'), resourceType: 'task',
      filters: (input.filters ?? {}) as Record<string, unknown>,
      visibility: requireString(input, 'visibility') as 'private' | 'team' | 'organization',
      ...(typeof input.teamId === 'string' ? { teamId: input.teamId } : {}),
    }),
  }
}

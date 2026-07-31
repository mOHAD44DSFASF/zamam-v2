import { tenantDocumentPath } from '@zamam/firestore'
import { TaskService, type TaskReferencePort } from '../../task/service.js'
import { TaskQueryService, SavedTaskViewService, type TaskQueryStore, type TaskSearchPort, type TaskViewScope } from '../../task/query.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery } from '../deps.js'
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

export function createTaskHandlers(deps: Deps): HandlerRegistry {
  const service = new TaskService(deps.store, deps.authorization, createReferencePort(deps))
  const queryService = new TaskQueryService(createQueryStore(deps), deps.authorization, searchPort)
  const savedViews = new SavedTaskViewService(deps.store, deps.authorization)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.create>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/tasks/query': async (context, input) => {
      const scopeInput = input.scope as { type?: string; userId?: string; teamId?: string; projectId?: string } | undefined
      const scope: TaskViewScope = scopeInput?.type === 'self'
        ? { type: 'self', userId: context.principal.userId }
        : scopeInput?.type === 'team' && typeof scopeInput.teamId === 'string'
          ? { type: 'team', teamId: scopeInput.teamId }
          : scopeInput?.type === 'project' && typeof scopeInput.projectId === 'string'
            ? { type: 'project', projectId: scopeInput.projectId }
            : { type: 'organization' }
      const page = await queryService.list(context.principal, {
        organizationId: context.organizationId, scope, filters: input.filters,
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      // Pick-lists for the create form: active projects and workspaces.
      const [projectPage, workspacePage] = await Promise.all([
        listQuery(deps, context.organizationId, 'project', {
          filters: [{ field: 'status', operator: 'in', value: ['draft', 'planned', 'active', 'on_hold'] }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
        listQuery(deps, context.organizationId, 'workspace', {
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
      ])
      const projects = projectPage.items.map((p) => ({ id: String(p.id), name: String(p.name) }))
      const workspaces = workspacePage.items.map((w) => ({ id: String(w.id), name: String(w.name), ...(typeof w.projectId === 'string' ? { projectId: w.projectId } : {}) }))
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        create: 'task.create', update: 'task.update', transition: 'task.transition',
        assign: 'task.assign', reopen: 'task.reopen', archive: 'task.archive', saveView: 'saved_view.create',
      })
      return { ...page, projects, workspaces, capabilities }
    },
    '/v1/tasks/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), projectId: requireString(input, 'projectId'),
      title: requireString(input, 'title'),
      ...(typeof input.workspaceId === 'string' ? { workspaceId: input.workspaceId } : {}),
      ...(typeof input.parentTaskId === 'string' ? { parentTaskId: input.parentTaskId } : {}),
      ...(typeof input.description === 'string' ? { description: input.description } : {}),
      ...(typeof input.priority === 'string' ? { priority: input.priority as 'low' | 'medium' | 'high' | 'urgent' } : {}),
      ...(typeof input.dueAt === 'string' ? { dueAt: input.dueAt } : {}),
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
    '/v1/task-views/create': (context, input) => savedViews.create(metadata(context), {
      id: requireString(input, 'id'), name: requireString(input, 'name'), resourceType: 'task',
      filters: (input.filters ?? {}) as Record<string, unknown>,
      visibility: requireString(input, 'visibility') as 'private' | 'team' | 'organization',
      ...(typeof input.teamId === 'string' ? { teamId: input.teamId } : {}),
    }),
  }
}

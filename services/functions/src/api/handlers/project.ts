import { ProjectService, type ProjectLifecyclePort } from '../../project/service.js'
import type { Deps } from '../deps.js'
import { listQuery } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireBoolean, requireNumber, requireString } from '../registry.js'

function createLifecyclePort(deps: Deps): ProjectLifecyclePort {
  return {
    async activeWorkspaceCount(organizationId, projectId) {
      const page = await listQuery(deps, organizationId, 'workspace', {
        filters: [{ field: 'projectId', operator: '==', value: projectId }, { field: 'status', operator: '==', value: 'active' }],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
      })
      return page.items.length
    },
    async openTaskCount(organizationId, projectId) {
      const page = await listQuery(deps, organizationId, 'task', {
        filters: [
          { field: 'projectId', operator: '==', value: projectId },
          { field: 'status', operator: 'in', value: ['draft', 'ready', 'in_progress', 'blocked', 'in_review', 'approved'] },
        ],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
      })
      return page.items.length
    },
  }
}

export function createProjectHandlers(deps: Deps): HandlerRegistry {
  const service = new ProjectService(deps.store, deps.authorization, createLifecyclePort(deps))
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.create>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/projects/query': async (context, input) => {
      const clientId = typeof input.clientId === 'string' ? input.clientId : undefined
      await deps.authorization.require(context.principal, {
        permission: 'project.view', organizationId: context.organizationId,
        ...(clientId ? { resource: { type: 'client', id: clientId, organizationId: context.organizationId, clientAccountId: clientId, visibility: 'internal' as const } } : {}),
      })
      const page = await listQuery(deps, context.organizationId, 'project', {
        filters: [
          { field: 'status', operator: 'in', value: ['draft', 'planned', 'active', 'on_hold', 'completed'] },
          ...(clientId ? [{ field: 'clientId', operator: '==' as const, value: clientId }] : []),
        ],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 50,
      })
      return { items: page.items, nextCursor: page.nextCursor }
    },
    '/v1/projects/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), clientId: requireString(input, 'clientId'), name: requireString(input, 'name'),
      code: requireString(input, 'code'), managerUserId: requireString(input, 'managerUserId'),
      ...(typeof input.departmentId === 'string' ? { departmentId: input.departmentId } : {}),
      ...(typeof input.startsOn === 'string' ? { startsOn: input.startsOn } : {}),
      ...(typeof input.dueOn === 'string' ? { dueOn: input.dueOn } : {}),
      clientVisible: typeof input.clientVisible === 'boolean' ? input.clientVisible : false,
    }),
    '/v1/projects/client-visibility': (context, input) => service.setClientVisibility(
      metadata(context), requireString(input, 'projectId'), requireNumber(input, 'expectedVersion'), requireBoolean(input, 'clientVisible'),
    ),
  }
}

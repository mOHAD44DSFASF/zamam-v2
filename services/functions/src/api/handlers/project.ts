import { ProjectService, type ProjectLifecyclePort } from '../../project/service.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, resolveNames } from '../deps.js'
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
      // M2: resolve client / manager / department names once instead of returning raw ids.
      const rows = page.items as Record<string, unknown>[]
      const [clientNames, managerNames, departmentNames] = await Promise.all([
        resolveNames(deps, context.organizationId, 'client', rows.map((r) => String(r.clientId ?? ''))),
        resolveNames(deps, context.organizationId, 'user_profile', rows.map((r) => String(r.managerUserId ?? '')), 'displayName'),
        resolveNames(deps, context.organizationId, 'department', rows.map((r) => String(r.departmentId ?? ''))),
      ])
      const items = rows.map((r) => ({
        ...r,
        clientName: clientNames.get(String(r.clientId ?? '')) ?? '',
        managerName: managerNames.get(String(r.managerUserId ?? '')) ?? '',
        departmentName: r.departmentId ? departmentNames.get(String(r.departmentId)) ?? null : null,
      }))
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        create: 'project.create', manage: 'project.manage', manageMembers: 'project.member.manage',
        archive: 'project.archive', viewFinancial: 'project.financial.view', manageFinancial: 'project.financial.manage',
      })
      return { items, nextCursor: page.nextCursor, capabilities }
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

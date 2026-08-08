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
      // Pick-lists for the create form: active clients, active departments, and active members (managers).
      const [clientPage, departmentPage, membershipPage] = await Promise.all([
        listQuery(deps, context.organizationId, 'client', {
          filters: [{ field: 'status', operator: 'in', value: ['lead', 'active', 'paused'] }],
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
      const clients = clientPage.items.map((c) => ({ id: String(c.id), name: String(c.name) }))
      const departments = departmentPage.items.map((d) => ({ id: String(d.id), name: String(d.name) }))
      const managerProfiles = await resolveNames(deps, context.organizationId, 'user_profile', membershipPage.items.map((m) => String(m.userId)), 'displayName')
      const managers = membershipPage.items.map((m) => ({ userId: String(m.userId), displayName: managerProfiles.get(String(m.userId)) ?? String(m.userId) }))
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        create: 'project.create', manage: 'project.manage', manageMembers: 'project.member.manage',
        archive: 'project.archive', viewFinancial: 'project.financial.view', manageFinancial: 'project.financial.manage',
      })
      return { items, nextCursor: page.nextCursor, clients, departments, managers, capabilities }
    },
    '/v1/projects/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), name: requireString(input, 'name'),
      code: requireString(input, 'code'), managerUserId: requireString(input, 'managerUserId'),
      ...(typeof input.clientId === 'string' ? { clientId: input.clientId } : {}),
      ...(typeof input.departmentId === 'string' ? { departmentId: input.departmentId } : {}),
      ...(typeof input.startsOn === 'string' ? { startsOn: input.startsOn } : {}),
      ...(typeof input.dueOn === 'string' ? { dueOn: input.dueOn } : {}),
      clientVisible: typeof input.clientVisible === 'boolean' ? input.clientVisible : false,
    }),
    '/v1/projects/client-visibility': (context, input) => service.setClientVisibility(
      metadata(context), requireString(input, 'projectId'), requireNumber(input, 'expectedVersion'), requireBoolean(input, 'clientVisible'),
    ),
    '/v1/projects/transition': (context, input) => service.transition(
      metadata(context), requireString(input, 'projectId'), requireNumber(input, 'expectedVersion'),
      requireString(input, 'targetStatus') as 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled',
    ),
    // Bug 3 audit: ProjectService.archive() already existed (authorization/audit/outbox wired, capability
    // flag already computed above as `archive`) but had no HTTP route and no UI action.
    '/v1/projects/archive': (context, input) => service.archive(
      metadata(context), requireString(input, 'projectId'), requireNumber(input, 'expectedVersion'),
    ),
  }
}

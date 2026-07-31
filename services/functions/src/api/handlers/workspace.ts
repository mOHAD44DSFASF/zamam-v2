import { WorkspaceService, buildWorkspaceMembershipQuery, type WorkspaceLifecyclePort } from '../../workspace/service.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, resolveNames } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireString } from '../registry.js'

function createLifecyclePort(deps: Deps): WorkspaceLifecyclePort {
  return {
    async openTaskCount(organizationId, workspaceId) {
      const page = await listQuery(deps, organizationId, 'task', {
        filters: [
          { field: 'workspaceId', operator: '==', value: workspaceId },
          { field: 'status', operator: 'in', value: ['draft', 'ready', 'in_progress', 'blocked', 'in_review', 'approved'] },
        ],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
      })
      return page.items.length
    },
    async hasActiveInternalProjectMembership(organizationId, projectId, userId) {
      const page = await listQuery(deps, organizationId, 'project_member', {
        filters: [
          { field: 'projectId', operator: '==', value: projectId },
          { field: 'userId', operator: '==', value: userId },
          { field: 'status', operator: '==', value: 'active' },
        ],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
      })
      return page.items.length > 0
    },
  }
}

export function createWorkspaceHandlers(deps: Deps): HandlerRegistry {
  const service = new WorkspaceService(deps.store, deps.authorization, createLifecyclePort(deps))
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.create>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/workspaces/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'workspace.view', organizationId: context.organizationId })
      const query = buildWorkspaceMembershipQuery({ organizationId: context.organizationId, userId: context.principal.userId, limit: 50 })
      const memberships = await deps.queries.list<Record<string, unknown>>(
        `v2Organizations/${context.organizationId}/workspace_member`, query,
      )
      const workspaceIds = [...new Set(memberships.items.map((item) => String(item.workspaceId)))]
      const workspaces = await Promise.all(workspaceIds.map((id) =>
        deps.firestore.doc(`v2Organizations/${context.organizationId}/workspace/${id}`).get()))
      const rows = workspaces.filter((snapshot) => snapshot.exists).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as Record<string, unknown>)
      // M2: resolve project / owner-team names once instead of returning raw ids.
      const [projectNames, teamNames] = await Promise.all([
        resolveNames(deps, context.organizationId, 'project', rows.map((r) => String(r.projectId ?? ''))),
        resolveNames(deps, context.organizationId, 'team', rows.map((r) => String(r.ownerTeamId ?? ''))),
      ])
      const items = rows.map((r) => ({
        ...r,
        projectName: r.projectId ? projectNames.get(String(r.projectId)) ?? null : null,
        teamName: r.ownerTeamId ? teamNames.get(String(r.ownerTeamId)) ?? null : null,
      }))
      // Pick-lists for the create form: active projects and teams.
      const [projectPage, teamPage] = await Promise.all([
        listQuery(deps, context.organizationId, 'project', {
          filters: [{ field: 'status', operator: 'in', value: ['draft', 'planned', 'active', 'on_hold'] }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
        listQuery(deps, context.organizationId, 'team', {
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
      ])
      const projects = projectPage.items.map((p) => ({ id: String(p.id), name: String(p.name), ...(typeof p.departmentId === 'string' ? { departmentId: p.departmentId } : {}) }))
      const teams = teamPage.items.map((t) => ({ id: String(t.id), name: String(t.name), departmentId: String(t.departmentId ?? '') }))
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        create: 'workspace.create', manageMembers: 'workspace.member.manage', archive: 'workspace.archive',
      })
      return { items, projects, teams, capabilities }
    },
    '/v1/workspaces/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), name: requireString(input, 'name'),
      visibility: requireString(input, 'visibility') as 'private' | 'team' | 'project',
      ...(typeof input.projectId === 'string' ? { projectId: input.projectId } : {}),
      ...(typeof input.departmentId === 'string' ? { departmentId: input.departmentId } : {}),
      ...(typeof input.ownerTeamId === 'string' ? { ownerTeamId: input.ownerTeamId } : {}),
    }),
  }
}

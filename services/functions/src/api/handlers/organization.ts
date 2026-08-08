import { tenantCollectionPath } from '@zamam/firestore'
import { OrganizationStructureService } from '../../organization/service.js'
import type { Deps } from '../deps.js'
import { orgPath, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

export function createOrganizationHandlers(deps: Deps): HandlerRegistry {
  const service = new OrganizationStructureService(deps.store, deps.authorization)

  return {
    '/v1/organization/directory/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'organization.view', organizationId: context.organizationId })
      const [organization, departments, teams] = await Promise.all([
        readDoc(deps.firestore, orgPath(context.organizationId, 'organization', context.organizationId)),
        deps.queries.list<Record<string, unknown>>(tenantCollectionPath(context.organizationId, 'department'), {
          organizationId: context.organizationId, entityKind: 'department',
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
        }),
        deps.queries.list<Record<string, unknown>>(tenantCollectionPath(context.organizationId, 'team'), {
          organizationId: context.organizationId, entityKind: 'team',
          filters: [{ field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'name', direction: 'asc' }], limit: 200,
        }),
      ])
      const managerIds = [...new Set(departments.items.map((d) => d.managerUserId).filter((v): v is string => typeof v === 'string'))]
      const leaderIds = [...new Set(teams.items.map((t) => t.leaderUserId).filter((v): v is string => typeof v === 'string'))]
      const profiles = await Promise.all([...managerIds, ...leaderIds].map(async (userId) => [
        userId, await readDoc(deps.firestore, orgPath(context.organizationId, 'user_profile', userId)),
      ] as const))
      const nameById = new Map(profiles.map(([userId, profile]) => [userId, profile ? String(profile.displayName) : null]))
      const counters = await Promise.all([
        ...departments.items.map(async (d) => [String(d.id), await readDoc(deps.firestore, orgPath(context.organizationId, '_departmentActiveTeamCounts', String(d.id)))] as const),
        ...teams.items.map(async (t) => [String(t.id), await readDoc(deps.firestore, orgPath(context.organizationId, '_teamActiveMemberCounts', String(t.id)))] as const),
      ])
      const countById = new Map(counters.map(([id, value]) => [id, Number(value?.value ?? 0)]))
      const evaluate = async (permission: 'department.create' | 'team.create' | 'team.manage' | 'department.archive' | 'team.archive') =>
        (await deps.authorization.evaluate(context.principal, { permission, organizationId: context.organizationId })).allowed
      const [createDepartment, createTeam, manageMembership, archiveStructure, archiveTeam] = await Promise.all([
        evaluate('department.create'), evaluate('team.create'), evaluate('team.manage'), evaluate('department.archive'), evaluate('team.archive'),
      ])
      return {
        organization: organization
          ? { id: context.organizationId, name: String(organization.name), locale: organization.locale ?? 'ar', timezone: organization.timezone ?? 'Asia/Riyadh' }
          : { id: context.organizationId, name: '', locale: 'ar', timezone: 'Asia/Riyadh' },
        departments: departments.items.map((d) => ({
          id: String(d.id), name: String(d.name), code: String(d.code),
          managerName: typeof d.managerUserId === 'string' ? nameById.get(d.managerUserId) ?? null : null,
          activeTeamCount: countById.get(String(d.id)) ?? 0, version: Number(d.version ?? 1),
        })),
        teams: teams.items.map((t) => ({
          id: String(t.id), departmentId: String(t.departmentId), name: String(t.name), code: String(t.code),
          leaderName: typeof t.leaderUserId === 'string' ? nameById.get(t.leaderUserId) ?? null : null,
          activeMemberCount: countById.get(String(t.id)) ?? 0, version: Number(t.version ?? 1),
        })),
        capabilities: { createDepartment, createTeam, manageMembership, archiveStructure, archiveTeam },
      }
    },
    '/v1/organization/departments/create': (context, input) => service.createDepartment({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, { id: requireString(input, 'id'), name: requireString(input, 'name'), code: requireString(input, 'code') }),
    '/v1/organization/teams/create': (context, input) => service.createTeam({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, requireString(input, 'departmentId'), { id: requireString(input, 'id'), name: requireString(input, 'name'), code: requireString(input, 'code') }),
    // Bug 3 audit: archiveDepartment/archiveTeam already existed in OrganizationStructureService with full
    // authorization/audit/outbox wiring but had no HTTP route and no UI action.
    '/v1/organization/departments/archive': (context, input) => service.archiveDepartment({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, requireString(input, 'departmentId'), requireNumber(input, 'expectedVersion')),
    '/v1/organization/teams/archive': (context, input) => service.archiveTeam({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, requireString(input, 'teamId'), requireNumber(input, 'expectedVersion')),
  }
}

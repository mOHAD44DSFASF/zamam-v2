import { SCHEMA_VERSION } from '@zamam/domain'
import { proposeLegacyRoleMapping } from '@zamam/authorization'

export interface LegacyWorkspaceDocument {
  id: string
  name?: unknown
  members?: unknown
  supervisors?: unknown
  createdBy?: unknown
  createdAt?: unknown
}
export interface LegacyWorkspaceIssue {
  workspaceId: string
  code: 'INVALID_WORKSPACE' | 'ORPHAN_MEMBER' | 'ORPHAN_SUPERVISOR' | 'MISSING_CREATOR'
  reference?: string
}
export interface LegacyUserIssue {
  userId: string
  code: 'MISSING_LEGACY_ROLE' | 'ORPHAN_LEGACY_ROLE'
  reference?: string
}

export function mapLegacyWorkspaces(input: {
  organizationId: string
  workspaces: readonly LegacyWorkspaceDocument[]
  knownUserIds: ReadonlySet<string>
}) {
  const records: { path: string; data: Readonly<Record<string, unknown>> }[] = []
  const issues: LegacyWorkspaceIssue[] = []
  const seen = new Set<string>()
  for (const legacy of input.workspaces) {
    if (!legacy.id || typeof legacy.name !== 'string' || legacy.name.trim().length < 2 || seen.has(legacy.id)) {
      issues.push({ workspaceId: legacy.id || 'unknown', code: 'INVALID_WORKSPACE' })
      continue
    }
    seen.add(legacy.id)
    const creator = typeof legacy.createdBy === 'string' && input.knownUserIds.has(legacy.createdBy) ? legacy.createdBy : null
    if (!creator) issues.push({
      workspaceId: legacy.id, code: 'MISSING_CREATOR',
      ...(typeof legacy.createdBy === 'string' ? { reference: legacy.createdBy } : {}),
    })
    const memberships = new Map<string, 'manager' | 'supervisor' | 'member'>()
    if (creator) memberships.set(creator, 'manager')
    for (const [field, role, issue] of [
      ['members', 'member', 'ORPHAN_MEMBER'],
      ['supervisors', 'supervisor', 'ORPHAN_SUPERVISOR'],
    ] as const) {
      const values = Array.isArray(legacy[field]) ? legacy[field] : []
      for (const value of values) {
        if (typeof value !== 'string' || !input.knownUserIds.has(value)) {
          issues.push({
            workspaceId: legacy.id, code: issue,
            ...(typeof value === 'string' ? { reference: value } : {}),
          })
          continue
        }
        if (role === 'supervisor' || !memberships.has(value)) memberships.set(value, role)
      }
    }
    records.push({
      path: `v2Organizations/${input.organizationId}/workspace/${legacy.id}`,
      data: {
        organizationId: input.organizationId, schemaVersion: SCHEMA_VERSION, migrationSource: 'workspaces',
        name: legacy.name.trim(), visibility: 'private', status: 'active', createdBy: creator,
      },
    })
    for (const [userId, membershipRole] of memberships) {
      records.push({
        path: `v2Organizations/${input.organizationId}/workspace_member/${legacy.id}_${userId}`,
        data: {
          organizationId: input.organizationId, schemaVersion: SCHEMA_VERSION, migrationSource: 'workspaces',
          workspaceId: legacy.id, userId, membershipRole, source: 'explicit', status: 'active',
        },
      })
    }
  }
  return {
    sourceCount: input.workspaces.length,
    mappedWorkspaceCount: records.filter(({ path }) => path.includes('/workspace/')).length,
    mappedMembershipCount: records.filter(({ path }) => path.includes('/workspace_member/')).length,
    quarantinedCount: issues.length,
    records,
    issues,
  }
}

export function buildLegacyFoundationInventory(input: {
  organizationId: string
  users: readonly { id: string; role?: unknown; isDeleted?: unknown }[]
  roles: readonly { id: string; name?: unknown }[]
  workspaces: readonly LegacyWorkspaceDocument[]
}) {
  const knownUserIds = new Set(input.users.map(({ id }) => id).filter(Boolean))
  const workspace = mapLegacyWorkspaces({ organizationId: input.organizationId, workspaces: input.workspaces, knownUserIds })
  const roleInventory = input.roles.map((role) => {
    const name = typeof role.name === 'string' ? role.name : role.id
    const proposal = proposeLegacyRoleMapping(role.id)
    return { id: role.id, name, ...proposal }
  })
  const roleIds = new Set(input.roles.map(({ id }) => id))
  const userIssues: LegacyUserIssue[] = input.users.flatMap((user): LegacyUserIssue[] => {
    if (typeof user.role !== 'string') return [{ userId: user.id, code: 'MISSING_LEGACY_ROLE' as const }]
    if (!roleIds.has(user.role)) return [{ userId: user.id, code: 'ORPHAN_LEGACY_ROLE' as const, reference: user.role }]
    return []
  })
  return {
    sourceCounts: { users: input.users.length, roles: input.roles.length, workspaces: input.workspaces.length },
    accountedCounts: {
      users: input.users.length,
      roles: roleInventory.length,
      workspaces: input.workspaces.length,
    },
    roleInventory,
    workspace,
    userIssues,
    hasUnknownPrivilegedMapping: roleInventory.some(({ status, legacyRole, requiresScopeResolution }) =>
      (legacyRole === 'Admin' && status !== 'proposed')
      || (legacyRole === 'DeputyManager' && requiresScopeResolution)),
    hasUnclassifiedOrphan: userIssues.length > 0 || workspace.issues.some(({ code }) =>
      code === 'ORPHAN_MEMBER' || code === 'ORPHAN_SUPERVISOR'),
  }
}

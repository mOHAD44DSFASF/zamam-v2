import { describe, expect, it, vi } from 'vitest'
import { createDefaultRoles, type AuthorizationPrincipal, type Permission } from '@zamam/authorization'
import {
  RoleAssignmentService,
  TrustedAuthorizationService,
  type AuthorizationAuditPort,
  type PolicyStore,
  type RoleAssignmentPort,
} from '../services/functions/src/authorization/service'

const organizationId = 'org-1'
const roles = createDefaultRoles(organizationId, 7)
const ownerAssignment = {
  id: 'owner-assignment', organizationId, userId: 'owner-1', roleId: roles.Owner.id,
  scope: { type: 'organization' as const, id: organizationId }, effect: 'grant' as const, status: 'active' as const,
}
const principal: AuthorizationPrincipal = {
  userId: 'owner-1', authenticated: true, tokenFresh: true, accountStatus: 'active', employmentStatus: 'active',
  organizationId, membershipStatus: 'active', principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}

function fixture(actorPermissions: ReadonlySet<Permission> = new Set(roles.Owner.permissions as Permission[])) {
  const policyStore: PolicyStore = { load: vi.fn().mockResolvedValue({ roles: [roles.Owner], assignments: [ownerAssignment], version: 7 }) }
  const audit: AuthorizationAuditPort = { record: vi.fn().mockResolvedValue(undefined) }
  const authorization = new TrustedAuthorizationService(policyStore, audit)
  const port: RoleAssignmentPort = {
    actorPermissions: vi.fn().mockResolvedValue(actorPermissions),
    scopeContains: vi.fn().mockResolvedValue(true),
    actorAssignmentScope: vi.fn().mockResolvedValue(ownerAssignment.scope),
    persist: vi.fn().mockResolvedValue(undefined),
  }
  return { service: new RoleAssignmentService(authorization, port), audit, port }
}

describe('trusted authorization service', () => {
  it('audits sensitive allowed decisions and persists a bounded assignment', async () => {
    const { service, audit, port } = fixture()
    const targetRole = { ...roles.Employee, id: 'custom-employee', permissions: ['task.view'] }
    await service.assign(principal, {
      organizationId, targetUserId: 'user-2', role: targetRole,
      scope: { type: 'team', id: 'team-1' }, expectedPolicyVersion: 7, idempotencyKey: 'assign-role-1',
    })
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ permission: 'role.assign', allowed: true }))
    expect(port.persist).toHaveBeenCalledTimes(1)
  })

  it('denies granting a permission the actor does not hold', async () => {
    const { service, port } = fixture(new Set<Permission>(['role.assign', 'task.view']))
    const targetRole = { ...roles.Employee, id: 'escalating-role', permissions: ['role.manage'] }
    await expect(service.assign(principal, {
      organizationId, targetUserId: 'user-2', role: targetRole,
      scope: { type: 'team', id: 'team-1' }, expectedPolicyVersion: 7, idempotencyKey: 'assign-role-2',
    })).rejects.toThrow('PERMISSION_ESCALATION')
    expect(port.persist).not.toHaveBeenCalled()
  })

  it('enforces optimistic policy version before persistence', async () => {
    const { service, port } = fixture()
    await expect(service.assign(principal, {
      organizationId, targetUserId: 'user-2', role: roles.Employee,
      scope: { type: 'team', id: 'team-1' }, expectedPolicyVersion: 6, idempotencyKey: 'assign-role-3',
    })).rejects.toThrow('POLICY_VERSION_CONFLICT')
    expect(port.persist).not.toHaveBeenCalled()
  })
})

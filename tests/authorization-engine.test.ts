import { describe, expect, it } from 'vitest'
import {
  PERMISSIONS,
  authorize,
  createDefaultRoles,
  evaluateAntiEscalation,
  proposeLegacyRoleMapping,
  type AuthorizationPrincipal,
  type AuthorizationScope,
  type Permission,
  type ResourceAuthorizationContext,
  type TrustedRole,
  type TrustedRoleAssignment,
} from '@zamam/authorization'

const organizationId = 'org-1'
const roles = createDefaultRoles(organizationId)

const principal = (overrides: Partial<AuthorizationPrincipal> = {}): AuthorizationPrincipal => ({
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId, membershipStatus: 'active', principalType: 'member',
  clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true, ...overrides,
})

const task = (overrides: Partial<ResourceAuthorizationContext> = {}): ResourceAuthorizationContext => ({
  type: 'task', id: 'task-1', organizationId, departmentId: 'department-1', teamId: 'team-1',
  projectId: 'project-1', workspaceId: 'workspace-1', ownerUserId: 'user-2',
  assigneeUserIds: ['user-1'], visibility: 'internal', ...overrides,
})

function assignment(role: TrustedRole, scope: AuthorizationScope = { type: 'organization', id: organizationId }, overrides: Partial<TrustedRoleAssignment> = {}): TrustedRoleAssignment {
  return {
    id: `assignment:${role.id}`, organizationId: role.organizationId, userId: 'user-1', roleId: role.id,
    scope, effect: 'grant', status: 'active', ...overrides,
  }
}

describe('authorization deny-by-default', () => {
  it('denies an unknown permission', () => {
    expect(authorize(principal(), { permission: 'unknown.action', organizationId, resource: task() }, Object.values(roles), [])).toMatchObject({ allowed: false, reason: 'UNKNOWN_PERMISSION' })
  })

  it.each(['disabled', 'archived'] as const)('denies %s accounts before evaluating grants', (accountStatus) => {
    expect(authorize(principal({ accountStatus }), { permission: 'task.view', organizationId, resource: task() }, [roles.Owner], [assignment(roles.Owner)])).toMatchObject({ allowed: false, reason: 'ACCOUNT_INACTIVE' })
  })

  it('denies a stale token and inactive membership', () => {
    expect(authorize(principal({ tokenFresh: false }), { permission: 'task.view', organizationId, resource: task() }, [roles.Employee], [assignment(roles.Employee)])).toMatchObject({ reason: 'TOKEN_STALE' })
    expect(authorize(principal({ membershipStatus: 'suspended' }), { permission: 'task.view', organizationId, resource: task() }, [roles.Employee], [assignment(roles.Employee)])).toMatchObject({ reason: 'MEMBERSHIP_INACTIVE' })
  })

  it.each(Object.keys(roles))('denies cross-organization access for %s', (roleName) => {
    const role = roles[roleName as keyof typeof roles]
    expect(authorize(principal(), { permission: role.permissions[0] ?? 'task.view', organizationId: 'org-2', resource: task({ organizationId: 'org-2' }) }, [role], [assignment(role)])).toMatchObject({ allowed: false, reason: 'CROSS_ORGANIZATION_DENIED' })
  })

  it.each(Object.keys(roles))('denies disabled accounts for %s', (roleName) => {
    const role = roles[roleName as keyof typeof roles]
    expect(authorize(principal({ accountStatus: 'disabled' }), {
      permission: role.permissions[0] ?? 'task.view', organizationId, resource: task(),
    }, [role], [assignment(role)])).toMatchObject({ allowed: false, reason: 'ACCOUNT_INACTIVE' })
  })

  it('applies explicit deny before Owner grants', () => {
    const grant = assignment(roles.Owner)
    const deny = assignment(roles.Owner, { type: 'resource', id: 'task-1', resourceType: 'task' }, {
      id: 'deny-1', effect: 'deny', permissions: ['task.delete'],
    })
    expect(authorize(principal(), { permission: 'task.delete', organizationId, resource: task() }, [roles.Owner], [grant, deny])).toMatchObject({ allowed: false, reason: 'EXPLICIT_DENY' })
  })

  it('requires step-up and MFA for sensitive operations', () => {
    const noStepUp = authorize(principal({ stepUpSatisfied: false }), { permission: 'audit.export', organizationId }, [roles.Owner], [assignment(roles.Owner)])
    expect(noStepUp).toMatchObject({ reason: 'STEP_UP_REQUIRED', auditRequired: true })
    const noMfa = authorize(principal({ mfaSatisfied: false }), { permission: 'audit.export', organizationId }, [roles.Owner], [assignment(roles.Owner)])
    expect(noMfa).toMatchObject({ reason: 'MFA_REQUIRED', auditRequired: true })
  })
})

describe('resource scopes', () => {
  const customRole: TrustedRole = { id: 'custom', organizationId, name: 'Scoped', permissions: ['task.view'], status: 'active', policyVersion: 3 }
  it.each([
    [{ type: 'organization', id: organizationId }, true],
    [{ type: 'department', id: 'department-1' }, true],
    [{ type: 'team', id: 'team-1' }, true],
    [{ type: 'team', id: 'team-2' }, false],
    [{ type: 'project', id: 'project-1' }, true],
    [{ type: 'workspace', id: 'workspace-1' }, true],
    [{ type: 'self', id: 'user-1' }, true],
    [{ type: 'resource', id: 'task-1', resourceType: 'task' }, true],
  ] as const)('evaluates scope %o', (scope, allowed) => {
    expect(authorize(principal(), { permission: 'task.view', organizationId, resource: task() }, [customRole], [assignment(customRole, scope)])).toMatchObject({ allowed })
  })

  it('does not use ownership as an implicit grant', () => {
    expect(authorize(principal(), { permission: 'task.delete', organizationId, resource: task({ ownerUserId: 'user-1' }) }, [], [])).toMatchObject({ allowed: false, reason: 'PERMISSION_NOT_GRANTED' })
  })

  it('ignores expired assignments', () => {
    const expired = assignment(customRole, { type: 'organization', id: organizationId }, { expiresAt: '2025-01-01T00:00:00.000Z' })
    expect(authorize(principal(), { permission: 'task.view', organizationId, resource: task() }, [customRole], [expired], new Date('2026-01-01T00:00:00.000Z'))).toMatchObject({ allowed: false })
  })

  it('denies malformed unknown scopes', () => {
    const malformed = assignment(customRole, { type: 'unknown' as AuthorizationScope['type'], id: 'x' })
    expect(authorize(principal(), { permission: 'task.view', organizationId, resource: task() }, [customRole], [malformed])).toMatchObject({ allowed: false, reason: 'UNKNOWN_SCOPE' })
  })
})

describe('client and platform boundaries', () => {
  it('allows only client-visible resources belonging to the client account', () => {
    const clientPrincipal = principal({ principalType: 'client', clientAccountIds: ['client-1'] })
    const clientAssignment = assignment(roles.Client, { type: 'client_account', id: 'client-1' })
    const visible = task({ visibility: 'client', clientAccountId: 'client-1' })
    expect(authorize(clientPrincipal, { permission: 'task.view', organizationId, resource: visible }, [roles.Client], [clientAssignment])).toMatchObject({ allowed: true })
    expect(authorize(clientPrincipal, { permission: 'task.view', organizationId, resource: task({ visibility: 'internal', clientAccountId: 'client-1' }) }, [roles.Client], [clientAssignment])).toMatchObject({ reason: 'CLIENT_VISIBILITY_DENIED' })
  })

  it('denies internal comments even if a malformed custom client role grants them', () => {
    const role: TrustedRole = { id: 'bad-client', organizationId, name: 'Bad', permissions: ['comment.internal.view'], status: 'active', policyVersion: 1 }
    const result = authorize(principal({ principalType: 'client', clientAccountIds: ['client-1'] }), {
      permission: 'comment.internal.view', organizationId, resource: task({ visibility: 'client', clientAccountId: 'client-1' }),
    }, [role], [assignment(role, { type: 'client_account', id: 'client-1' })])
    expect(result).toMatchObject({ allowed: false, reason: 'CLIENT_VISIBILITY_DENIED' })
  })

  it('keeps SystemAdministrator out of tenant content without JIT membership', () => {
    const system = principal({ organizationId: null, membershipStatus: 'not_applicable', employmentStatus: 'not_applicable', principalType: 'system_administrator' })
    expect(authorize(system, { permission: 'task.view', organizationId, resource: task() }, [roles.SystemAdministrator], [assignment(roles.SystemAdministrator, { type: 'platform', id: 'platform' })])).toMatchObject({ allowed: false, reason: 'CROSS_ORGANIZATION_DENIED' })
    expect(authorize(system, { permission: 'platform.health.view', organizationId: null }, [roles.SystemAdministrator], [assignment(roles.SystemAdministrator, { type: 'platform', id: 'platform' })])).toMatchObject({ allowed: true })
  })
})

describe('Manager vs Department Lead task creation (same shape, different assignment scope)', () => {
  const createTask = (overrides: Partial<ResourceAuthorizationContext> = {}) =>
    task({ departmentId: 'department-1', ownerUserId: 'user-1', ...overrides })

  it("a Department Lead assigned to their own department can create tasks there, but not in a different department", () => {
    const lead = assignment(roles.DepartmentLead, { type: 'department', id: 'department-1' })
    expect(authorize(principal(), { permission: 'task.create', organizationId, resource: createTask() }, [roles.DepartmentLead], [lead]))
      .toMatchObject({ allowed: true })
    expect(authorize(principal(), { permission: 'task.create', organizationId, resource: createTask({ departmentId: 'department-2' }) }, [roles.DepartmentLead], [lead]))
      .toMatchObject({ allowed: false, reason: 'RESOURCE_SCOPE_DENIED' })
  })

  it('a Manager assigned at organization scope can create tasks in any department', () => {
    const manager = assignment(roles.Manager, { type: 'organization', id: organizationId })
    expect(authorize(principal(), { permission: 'task.create', organizationId, resource: createTask({ departmentId: 'department-1' }) }, [roles.Manager], [manager]))
      .toMatchObject({ allowed: true })
    expect(authorize(principal(), { permission: 'task.create', organizationId, resource: createTask({ departmentId: 'department-2' }) }, [roles.Manager], [manager]))
      .toMatchObject({ allowed: true })
  })

  it('Area 1: only Owner/GeneralManager and Manager can invite/create members — Manager gets user.invite added on top of the shared departmentManager set, DepartmentLead and DepartmentManager do not', () => {
    expect(roles.Owner.permissions).toContain('user.invite')
    expect(roles.GeneralManager.permissions).toContain('user.invite')
    expect(roles.Manager.permissions).toContain('user.invite')
    expect(roles.DepartmentLead.permissions).not.toContain('user.invite')
    expect(roles.DepartmentManager.permissions).not.toContain('user.invite')
    expect(roles.Employee.permissions).not.toContain('user.invite')
    const manager = assignment(roles.Manager, { type: 'organization', id: organizationId })
    expect(authorize(principal(), { permission: 'user.invite', organizationId }, [roles.Manager], [manager]))
      .toMatchObject({ allowed: true })
    const lead = assignment(roles.DepartmentLead, { type: 'department', id: 'department-1' })
    expect(authorize(principal(), { permission: 'user.invite', organizationId }, [roles.DepartmentLead], [lead]))
      .toMatchObject({ allowed: false, reason: 'PERMISSION_NOT_GRANTED' })
  })

  it('a plain Employee cannot create tasks in their own or any department (no task.create permission)', () => {
    const employee = assignment(roles.Employee, { type: 'department', id: 'department-1' })
    expect(authorize(principal(), { permission: 'task.create', organizationId, resource: createTask() }, [roles.Employee], [employee]))
      .toMatchObject({ allowed: false, reason: 'PERMISSION_NOT_GRANTED' })
  })

  it("an Employee's task.view (assigned at 'self' scope) only sees tasks they're an assignee of", () => {
    const employee = assignment(roles.Employee, { type: 'self', id: 'user-1' })
    expect(authorize(principal(), { permission: 'task.view', organizationId, resource: task({ assigneeUserIds: ['user-1'] }) }, [roles.Employee], [employee]))
      .toMatchObject({ allowed: true })
    expect(authorize(principal(), { permission: 'task.view', organizationId, resource: task({ assigneeUserIds: ['user-2'], ownerUserId: 'user-2' }) }, [roles.Employee], [employee]))
      .toMatchObject({ allowed: false, reason: 'RESOURCE_SCOPE_DENIED' })
  })
})

describe('anti-escalation', () => {
  const scope: AuthorizationScope = { type: 'department', id: 'department-1' }
  it('allows only known permissions already held inside an allowed scope', () => {
    const actor = new Set<Permission>(['task.view', 'task.update'])
    expect(evaluateAntiEscalation(actor, ['task.view'], scope, scope, () => true)).toEqual({ allowed: true, reason: 'ALLOWED' })
    expect(evaluateAntiEscalation(actor, ['role.manage'], scope, scope, () => true)).toEqual({ allowed: false, reason: 'PERMISSION_ESCALATION' })
    expect(evaluateAntiEscalation(actor, ['not.real'], scope, scope, () => true)).toEqual({ allowed: false, reason: 'UNKNOWN_PERMISSION' })
    expect(evaluateAntiEscalation(actor, ['task.view'], scope, { type: 'organization', id: organizationId }, () => false)).toEqual({ allowed: false, reason: 'SCOPE_ESCALATION' })
  })

  it('catalog contains no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})

describe('legacy role migration safety', () => {
  it('never infers Owner from legacy Admin', () => {
    expect(proposeLegacyRoleMapping('Admin')).toMatchObject({ proposedRole: 'GeneralManager', grantsApplied: false })
  })

  it.each(['Manager', 'CustomRole', 'Reviewer', 'Uploader'])('quarantines ambiguous role %s without grants', (legacyRole) => {
    expect(proposeLegacyRoleMapping(legacyRole)).toMatchObject({ status: 'quarantine', grantsApplied: false, requiresScopeResolution: true })
  })
})

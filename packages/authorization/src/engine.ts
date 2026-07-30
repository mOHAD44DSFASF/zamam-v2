import { isPermission, SENSITIVE_PERMISSIONS, type Permission } from './catalog.js'
import type {
  AuthorizationDecision, AuthorizationPrincipal, AuthorizationRequest, AuthorizationScope,
  ResourceAuthorizationContext, TrustedRole, TrustedRoleAssignment,
} from './types.js'

const scopeTypes = new Set(['platform', 'organization', 'department', 'team', 'project', 'workspace', 'client_account', 'self', 'resource'])
const mfaRequired = new Set<Permission>([
  'organization.suspend', 'security.policy.manage', 'audit.export', 'support.access.grant',
  'integration.credential.rotate', 'platform.tenant.provision', 'platform.tenant.support', 'platform.incident.manage',
])

function decision(reason: AuthorizationDecision['reason'], policyVersion: number, permission?: Permission, scope?: AuthorizationScope): AuthorizationDecision {
  const allowed = reason === 'ALLOWED'
  const auditRequired = permission ? SENSITIVE_PERMISSIONS.has(permission) || (!allowed && mfaRequired.has(permission)) : false
  return scope
    ? { allowed, reason, policyVersion, effectiveScope: scope, auditRequired }
    : { allowed, reason, policyVersion, auditRequired }
}

function assignmentActive(assignment: TrustedRoleAssignment, now: Date) {
  if (assignment.status !== 'active') return false
  const timestamp = now.getTime()
  if (assignment.startsAt && Date.parse(assignment.startsAt) > timestamp) return false
  if (assignment.expiresAt && Date.parse(assignment.expiresAt) <= timestamp) return false
  return true
}

function scopeMatches(scope: AuthorizationScope, resource: ResourceAuthorizationContext | undefined, principal: AuthorizationPrincipal) {
  if (!scopeTypes.has(scope.type)) return false
  if (scope.type === 'platform') return !resource
  if (scope.type === 'organization') return true
  if (!resource) return false
  if (scope.type === 'department') return resource.departmentId === scope.id || (resource.type === 'department' && resource.id === scope.id)
  if (scope.type === 'team') return resource.teamId === scope.id || (resource.type === 'team' && resource.id === scope.id)
  if (scope.type === 'project') return resource.projectId === scope.id || (resource.type === 'project' && resource.id === scope.id)
  if (scope.type === 'workspace') return resource.workspaceId === scope.id || (resource.type === 'workspace' && resource.id === scope.id)
  if (scope.type === 'client_account') return resource.clientAccountId === scope.id
  if (scope.type === 'resource') return resource.type === scope.resourceType && resource.id === scope.id
  return resource.ownerUserId === principal.userId
    || resource.assigneeUserIds?.includes(principal.userId) === true
    || (resource.type === 'user' && resource.id === principal.userId)
}

function clientBoundaryDenied(principal: AuthorizationPrincipal, permission: Permission, resource?: ResourceAuthorizationContext) {
  if (principal.principalType !== 'client') return false
  if (
    permission.startsWith('comment.internal.')
    || permission === 'file.internal.view'
    || permission.startsWith('attendance.')
    || permission.startsWith('employment.')
    || permission.startsWith('kpi.')
    || permission.startsWith('performance.')
    || permission === 'audit.view'
    || permission === 'audit.export'
  ) return true
  if (!resource) return false
  return resource.visibility !== 'client'
    || !resource.clientAccountId
    || !principal.clientAccountIds.includes(resource.clientAccountId)
}

export function authorize(
  principal: AuthorizationPrincipal,
  request: AuthorizationRequest,
  roles: readonly TrustedRole[],
  assignments: readonly TrustedRoleAssignment[],
  now: Date = new Date(),
): AuthorizationDecision {
  const policyVersion = Math.max(0, ...roles.map(({ policyVersion }) => policyVersion))
  if (!principal.authenticated) return decision('AUTHENTICATION_REQUIRED', policyVersion)
  if (!principal.tokenFresh) return decision('TOKEN_STALE', policyVersion)
  if (principal.accountStatus !== 'active') return decision('ACCOUNT_INACTIVE', policyVersion)
  if (principal.employmentStatus === 'ended') return decision('EMPLOYMENT_INACTIVE', policyVersion)
  if (!isPermission(request.permission)) return decision('UNKNOWN_PERMISSION', policyVersion)
  const permission = request.permission

  if (request.organizationId !== null) {
    if (principal.organizationId !== request.organizationId) return decision('CROSS_ORGANIZATION_DENIED', policyVersion, permission)
    if (principal.membershipStatus !== 'active') return decision('MEMBERSHIP_INACTIVE', policyVersion, permission)
    if (request.resource && request.resource.organizationId !== request.organizationId) return decision('CROSS_ORGANIZATION_DENIED', policyVersion, permission)
  } else if (!permission.startsWith('platform.')) {
    return decision('CROSS_ORGANIZATION_DENIED', policyVersion, permission)
  }

  if (clientBoundaryDenied(principal, permission, request.resource)) {
    return decision('CLIENT_VISIBILITY_DENIED', policyVersion, permission)
  }

  const roleMap = new Map(roles.filter(({ status }) => status === 'active').map((role) => [role.id, role]))
  const relevant = assignments.filter((assignment) => assignment.userId === principal.userId
    && assignmentActive(assignment, now)
    && assignment.organizationId === request.organizationId)
  if (relevant.some((assignment) => !scopeTypes.has(assignment.scope.type))) {
    return decision('UNKNOWN_SCOPE', policyVersion, permission)
  }
  const active = relevant

  const grantsPermission = (assignment: TrustedRoleAssignment) => {
    const source = assignment.permissions ?? roleMap.get(assignment.roleId)?.permissions ?? []
    return source.includes(permission)
  }
  const scopeEligible = (assignment: TrustedRoleAssignment) => scopeMatches(assignment.scope, request.resource, principal)

  const explicitDeny = active.find((assignment) => assignment.effect === 'deny' && scopeEligible(assignment) && (assignment.permissions === undefined || grantsPermission(assignment)))
  if (explicitDeny) return decision('EXPLICIT_DENY', policyVersion, permission, explicitDeny.scope)

  const grant = active.find((assignment) => assignment.effect === 'grant' && grantsPermission(assignment) && scopeEligible(assignment))
  if (!grant) {
    const hasPermissionOutsideScope = active.some((assignment) => assignment.effect === 'grant' && grantsPermission(assignment))
    return decision(hasPermissionOutsideScope ? 'RESOURCE_SCOPE_DENIED' : 'PERMISSION_NOT_GRANTED', policyVersion, permission)
  }

  if ((request.requireStepUp || SENSITIVE_PERMISSIONS.has(permission)) && !principal.stepUpSatisfied) {
    return decision('STEP_UP_REQUIRED', policyVersion, permission, grant.scope)
  }
  if ((request.requireMfa || mfaRequired.has(permission)) && !principal.mfaSatisfied) {
    return decision('MFA_REQUIRED', policyVersion, permission, grant.scope)
  }
  const businessInput = request.resource
    ? { principal, permission, resource: request.resource }
    : { principal, permission }
  const business = request.businessRule?.(businessInput)
  if (business !== undefined && business !== true) return decision('BUSINESS_STATE_DENIED', policyVersion, permission, grant.scope)
  return decision('ALLOWED', policyVersion, permission, grant.scope)
}

export function evaluateAntiEscalation(
  actorPermissions: ReadonlySet<Permission>,
  targetPermissions: readonly string[],
  actorScope: AuthorizationScope,
  targetScope: AuthorizationScope,
  scopeContains: (actor: AuthorizationScope, target: AuthorizationScope) => boolean,
) {
  if (!targetPermissions.every(isPermission)) return { allowed: false, reason: 'UNKNOWN_PERMISSION' as const }
  if (!targetPermissions.every((permission) => actorPermissions.has(permission))) return { allowed: false, reason: 'PERMISSION_ESCALATION' as const }
  if (!scopeContains(actorScope, targetScope)) return { allowed: false, reason: 'SCOPE_ESCALATION' as const }
  return { allowed: true, reason: 'ALLOWED' as const }
}

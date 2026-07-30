import {
  authorize,
  evaluateAntiEscalation,
  type AuthorizationDecision,
  type AuthorizationPrincipal,
  type AuthorizationRequest,
  type AuthorizationScope,
  type Permission,
  type TrustedRole,
  type TrustedRoleAssignment,
} from '@zamam/authorization'

export interface PolicySnapshot {
  roles: readonly TrustedRole[]
  assignments: readonly TrustedRoleAssignment[]
  version: number
}

export interface PolicyStore {
  load(userId: string, organizationId: string | null): Promise<PolicySnapshot>
}

export interface AuthorizationAuditPort {
  record(input: {
    actorUserId: string
    organizationId: string | null
    permission: string
    allowed: boolean
    reason: string
    policyVersion: number
  }): Promise<void>
}

export class TrustedAuthorizationService {
  constructor(private readonly policies: PolicyStore, private readonly audit: AuthorizationAuditPort) {}

  async evaluate(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const snapshot = await this.policies.load(principal.userId, request.organizationId)
    const result = authorize(principal, request, snapshot.roles, snapshot.assignments)
    if (result.auditRequired) {
      await this.audit.record({
        actorUserId: principal.userId,
        organizationId: request.organizationId,
        permission: request.permission,
        allowed: result.allowed,
        reason: result.reason,
        policyVersion: result.policyVersion,
      })
    }
    return result
  }

  async require(principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    const result = await this.evaluate(principal, request)
    if (!result.allowed) throw new Error('AUTHORIZATION_DENIED')
    return result
  }
}

export interface AssignRoleCommand {
  organizationId: string
  targetUserId: string
  role: TrustedRole
  scope: AuthorizationScope
  expectedPolicyVersion: number
  idempotencyKey: string
}

export interface RoleAssignmentPort {
  actorPermissions(principal: AuthorizationPrincipal, scope: AuthorizationScope): Promise<ReadonlySet<Permission>>
  scopeContains(actorScope: AuthorizationScope, targetScope: AuthorizationScope): Promise<boolean>
  actorAssignmentScope(principal: AuthorizationPrincipal): Promise<AuthorizationScope>
  persist(command: AssignRoleCommand, actorUserId: string): Promise<void>
}

export class RoleAssignmentService {
  constructor(private readonly authorization: TrustedAuthorizationService, private readonly port: RoleAssignmentPort) {}

  async assign(principal: AuthorizationPrincipal, command: AssignRoleCommand) {
    const authorization = await this.authorization.require(principal, {
      permission: 'role.assign',
      organizationId: command.organizationId,
      resource: { type: 'user', id: command.targetUserId, organizationId: command.organizationId },
      requireStepUp: true,
    })
    if (authorization.policyVersion !== command.expectedPolicyVersion) throw new Error('POLICY_VERSION_CONFLICT')
    if (command.role.organizationId !== command.organizationId || command.role.status !== 'active') {
      throw new Error('ROLE_ASSIGNMENT_INVALID')
    }
    const actorScope = await this.port.actorAssignmentScope(principal)
    const actorPermissions = await this.port.actorPermissions(principal, actorScope)
    const scopeAllowed = await this.port.scopeContains(actorScope, command.scope)
    const antiEscalation = evaluateAntiEscalation(actorPermissions, command.role.permissions, actorScope, command.scope, () => scopeAllowed)
    if (!antiEscalation.allowed) throw new Error(antiEscalation.reason)
    await this.port.persist(command, principal.userId)
  }
}

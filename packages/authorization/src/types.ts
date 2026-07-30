import type { Permission } from './catalog.js'

export type ScopeType = 'platform' | 'organization' | 'department' | 'team' | 'project' | 'workspace' | 'client_account' | 'self' | 'resource'

export interface AuthorizationScope {
  type: ScopeType
  id: string
  resourceType?: string
}

export interface TrustedRole {
  id: string
  organizationId: string | null
  name: string
  permissions: readonly string[]
  status: 'active' | 'archived'
  policyVersion: number
}

export interface TrustedRoleAssignment {
  id: string
  organizationId: string | null
  userId: string
  roleId: string
  scope: AuthorizationScope
  effect: 'grant' | 'deny'
  permissions?: readonly string[]
  status: 'active' | 'revoked'
  startsAt?: string
  expiresAt?: string
}

export interface AuthorizationPrincipal {
  userId: string
  authenticated: boolean
  tokenFresh: boolean
  accountStatus: 'active' | 'disabled' | 'archived'
  employmentStatus: 'active' | 'leave' | 'ended' | 'not_applicable'
  organizationId: string | null
  membershipStatus: 'active' | 'suspended' | 'left' | 'not_applicable'
  principalType: 'member' | 'client' | 'system_administrator'
  clientAccountIds: readonly string[]
  stepUpSatisfied: boolean
  mfaSatisfied: boolean
}

export interface ResourceAuthorizationContext {
  type: string
  id: string
  organizationId: string
  departmentId?: string
  teamId?: string
  projectId?: string
  workspaceId?: string
  clientAccountId?: string
  ownerUserId?: string
  assigneeUserIds?: readonly string[]
  visibility?: 'internal' | 'project' | 'client' | 'restricted'
  state?: string
}

export interface AuthorizationRequest {
  permission: string
  organizationId: string | null
  resource?: ResourceAuthorizationContext
  requireStepUp?: boolean
  requireMfa?: boolean
  businessRule?: (input: { principal: AuthorizationPrincipal; permission: Permission; resource?: ResourceAuthorizationContext }) => true | string
}

export type AuthorizationReason =
  | 'ALLOWED'
  | 'AUTHENTICATION_REQUIRED'
  | 'TOKEN_STALE'
  | 'ACCOUNT_INACTIVE'
  | 'EMPLOYMENT_INACTIVE'
  | 'MEMBERSHIP_INACTIVE'
  | 'UNKNOWN_PERMISSION'
  | 'UNKNOWN_SCOPE'
  | 'CROSS_ORGANIZATION_DENIED'
  | 'EXPLICIT_DENY'
  | 'PERMISSION_NOT_GRANTED'
  | 'RESOURCE_SCOPE_DENIED'
  | 'CLIENT_VISIBILITY_DENIED'
  | 'STEP_UP_REQUIRED'
  | 'MFA_REQUIRED'
  | 'BUSINESS_STATE_DENIED'

export interface AuthorizationDecision {
  allowed: boolean
  reason: AuthorizationReason
  policyVersion: number
  effectiveScope?: AuthorizationScope
  auditRequired: boolean
}

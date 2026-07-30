export type AccountStatus = 'pending' | 'active' | 'disabled' | 'archived'
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'left'

export interface AuthenticatedIdentity {
  userId: string
  email: string | null
  emailVerified: boolean
  tokenIssuedAt: number
}

export interface OrganizationMembership {
  organizationId: string
  userId: string
  status: MembershipStatus
}

export interface SessionAccount {
  identity: AuthenticatedIdentity
  accountStatus: AccountStatus
  memberships: readonly OrganizationMembership[]
  tokensValidAfter: number
}

export type SessionDecision =
  | { kind: 'allow'; account: SessionAccount }
  | { kind: 'deny'; reason: 'ACCOUNT_INACTIVE' | 'NO_ACTIVE_MEMBERSHIP' | 'TOKEN_REVOKED' }

export function evaluateSession(account: SessionAccount): SessionDecision {
  if (account.identity.tokenIssuedAt < account.tokensValidAfter) {
    return { kind: 'deny', reason: 'TOKEN_REVOKED' }
  }
  if (account.accountStatus !== 'active') {
    return { kind: 'deny', reason: 'ACCOUNT_INACTIVE' }
  }
  if (!account.memberships.some(({ status }) => status === 'active')) {
    return { kind: 'deny', reason: 'NO_ACTIVE_MEMBERSHIP' }
  }
  return { kind: 'allow', account }
}

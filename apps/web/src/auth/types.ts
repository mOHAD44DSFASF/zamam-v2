export type AuthStatus = 'loading' | 'anonymous' | 'active' | 'must_change_password' | 'inactive' | 'error'

export interface ActiveMembershipView {
  organizationId: string
  status: 'active'
}

export interface SessionView {
  userId: string
  displayName: string
  email: string | null
  accountStatus: 'active' | 'disabled' | 'archived'
  memberships: readonly ActiveMembershipView[]
  mustChangePassword: boolean
}

export interface AuthState {
  status: AuthStatus
  session: SessionView | null
  reason?: 'ACCOUNT_INACTIVE' | 'NO_ACTIVE_MEMBERSHIP' | 'SESSION_LOOKUP_FAILED'
}

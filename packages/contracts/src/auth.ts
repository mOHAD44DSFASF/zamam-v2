export interface InviteUserCommand {
  organizationId: string
  email: string
  displayName: string
  requestedRoleIds: readonly string[]
  idempotencyKey: string
}

export interface AcceptInvitationCommand {
  invitationToken: string
  password: string
  idempotencyKey: string
}

export interface DisableUserCommand {
  organizationId: string
  targetUserId: string
  reason: string
  idempotencyKey: string
}

export interface RequestPasswordResetCommand {
  email: string
}

export interface PublicAuthResult {
  accepted: true
  messageCode: 'REQUEST_ACCEPTED'
}

export interface AuthenticatedPrincipal {
  userId: string
  tokenIssuedAt: number
  emailVerified: boolean
}

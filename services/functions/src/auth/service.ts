import { evaluateSession, type SessionAccount } from '@zamam/domain'
import type {
  AuthenticatedPrincipal,
  DisableUserCommand,
  InviteUserCommand,
  PublicAuthResult,
  RequestPasswordResetCommand,
} from '@zamam/contracts'

export interface AuthAdminPort {
  verifyToken(token: string, checkRevoked: boolean): Promise<AuthenticatedPrincipal>
  loadSessionAccount(userId: string): Promise<SessionAccount | null>
  disableIdentity(userId: string): Promise<void>
  revokeRefreshTokens(userId: string): Promise<void>
  persistDisabledAccount(command: DisableUserCommand, actorUserId: string): Promise<void>
  persistInvitation(command: InviteUserCommand, actorUserId: string): Promise<void>
  enqueueInvitation(command: InviteUserCommand): Promise<void>
  enqueuePasswordReset(command: RequestPasswordResetCommand): Promise<void>
  authorize(actor: SessionAccount, permission: 'user.invite' | 'user.disable', organizationId: string): Promise<void>
}

export class AuthService {
  constructor(private readonly port: AuthAdminPort) {}

  async authenticate(token: string): Promise<SessionAccount> {
    const principal = await this.port.verifyToken(token, true)
    const account = await this.port.loadSessionAccount(principal.userId)
    if (!account) throw new Error('AUTHORIZATION_DENIED')
    if (account.identity.userId !== principal.userId) throw new Error('AUTHORIZATION_DENIED')
    const currentAccount: SessionAccount = {
      ...account,
      identity: { ...account.identity, tokenIssuedAt: principal.tokenIssuedAt },
    }
    const decision = evaluateSession(currentAccount)
    if (decision.kind === 'deny') throw new Error('AUTHORIZATION_DENIED')
    return decision.account
  }

  async invite(actorToken: string, command: InviteUserCommand): Promise<PublicAuthResult> {
    const actor = await this.authenticate(actorToken)
    await this.port.authorize(actor, 'user.invite', command.organizationId)
    await this.port.persistInvitation(command, actor.identity.userId)
    await this.port.enqueueInvitation(command)
    return { accepted: true, messageCode: 'REQUEST_ACCEPTED' }
  }

  async disable(actorToken: string, command: DisableUserCommand): Promise<void> {
    const actor = await this.authenticate(actorToken)
    if (actor.identity.userId === command.targetUserId) throw new Error('SELF_DISABLE_DENIED')
    await this.port.authorize(actor, 'user.disable', command.organizationId)
    await this.port.persistDisabledAccount(command, actor.identity.userId)
    await this.port.disableIdentity(command.targetUserId)
    await this.port.revokeRefreshTokens(command.targetUserId)
  }

  async requestPasswordReset(command: RequestPasswordResetCommand): Promise<PublicAuthResult> {
    await this.port.enqueuePasswordReset(command)
    return { accepted: true, messageCode: 'REQUEST_ACCEPTED' }
  }
}

import { describe, expect, it, vi } from 'vitest'
import { evaluateSession, type SessionAccount } from '@zamam/domain'
import { AuthService, type AuthAdminPort } from '../services/functions/src/auth/service'

const activeAccount = (overrides: Partial<SessionAccount> = {}): SessionAccount => ({
  identity: { userId: 'user-1', email: 'user@example.com', emailVerified: true, tokenIssuedAt: 100 },
  accountStatus: 'active',
  memberships: [{ organizationId: 'org-1', userId: 'user-1', status: 'active' }],
  tokensValidAfter: 90,
  ...overrides,
})

function createPort(account: SessionAccount = activeAccount()): AuthAdminPort {
  return {
    verifyToken: vi.fn().mockResolvedValue({ userId: 'user-1', tokenIssuedAt: 100, emailVerified: true }),
    loadSessionAccount: vi.fn().mockResolvedValue(account),
    disableIdentity: vi.fn().mockResolvedValue(undefined),
    revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
    persistDisabledAccount: vi.fn().mockResolvedValue(undefined),
    persistInvitation: vi.fn().mockResolvedValue(undefined),
    enqueueInvitation: vi.fn().mockResolvedValue(undefined),
    enqueuePasswordReset: vi.fn().mockResolvedValue(undefined),
    authorize: vi.fn().mockResolvedValue(undefined),
  }
}

describe('session decisions', () => {
  it('allows an active account with an active membership', () => {
    expect(evaluateSession(activeAccount()).kind).toBe('allow')
  })

  it('denies disabled accounts', () => {
    expect(evaluateSession(activeAccount({ accountStatus: 'disabled' }))).toEqual({
      kind: 'deny', reason: 'ACCOUNT_INACTIVE',
    })
  })

  it('denies accounts without an active organization membership', () => {
    expect(evaluateSession(activeAccount({ memberships: [] }))).toEqual({
      kind: 'deny', reason: 'NO_ACTIVE_MEMBERSHIP',
    })
  })

  it('denies tokens issued before revocation', () => {
    expect(evaluateSession(activeAccount({ tokensValidAfter: 101 }))).toEqual({
      kind: 'deny', reason: 'TOKEN_REVOKED',
    })
  })
})

describe('AuthService', () => {
  it('checks revoked tokens when authenticating', async () => {
    const port = createPort()
    await new AuthService(port).authenticate('token')
    expect(port.verifyToken).toHaveBeenCalledWith('token', true)
  })

  it('revokes refresh tokens after disabling a user', async () => {
    const port = createPort()
    await new AuthService(port).disable('actor-token', {
      organizationId: 'org-1', targetUserId: 'user-2', reason: 'Owner request', idempotencyKey: 'idem-1',
    })
    expect(port.authorize).toHaveBeenCalledWith(expect.anything(), 'user.disable', 'org-1')
    expect(port.revokeRefreshTokens).toHaveBeenCalledWith('user-2')
  })

  it('prevents self-disable', async () => {
    const port = createPort()
    await expect(new AuthService(port).disable('actor-token', {
      organizationId: 'org-1', targetUserId: 'user-1', reason: 'invalid', idempotencyKey: 'idem-2',
    })).rejects.toThrow('SELF_DISABLE_DENIED')
    expect(port.disableIdentity).not.toHaveBeenCalled()
  })

  it('returns the same public reset response', async () => {
    const service = new AuthService(createPort())
    await expect(service.requestPasswordReset({ email: 'unknown@example.com' })).resolves.toEqual({
      accepted: true, messageCode: 'REQUEST_ACCEPTED',
    })
  })
})

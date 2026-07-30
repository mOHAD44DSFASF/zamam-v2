import { getAuth, type Auth } from 'firebase-admin/auth'
import type { EmployeeIdentityPort } from './service.js'

export class FirebaseEmployeeIdentityAdapter implements EmployeeIdentityPort {
  constructor(private readonly auth: Auth = getAuth()) {}

  async provisionInvitation(input: {
    email: string
    displayName: string
    organizationId: string
    idempotencyKey: string
  }) {
    try {
      const existing = await this.auth.getUserByEmail(input.email)
      return { userId: existing.uid, created: false }
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
    }
    try {
      const created = await this.auth.createUser({
        email: input.email,
        displayName: input.displayName,
        emailVerified: false,
        disabled: false,
      })
      return { userId: created.uid, created: true }
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/email-already-exists') throw error
      const existing = await this.auth.getUserByEmail(input.email)
      return { userId: existing.uid, created: false }
    }
  }

  async compensateInvitation(userId: string) {
    await this.auth.deleteUser(userId)
  }

  async disableIdentity(userId: string) {
    await this.auth.updateUser(userId, { disabled: true })
  }

  async revokeRefreshTokens(userId: string) {
    await this.auth.revokeRefreshTokens(userId)
  }

  async setPassword(userId: string, password: string) {
    await this.auth.updateUser(userId, { password, emailVerified: true })
  }
}

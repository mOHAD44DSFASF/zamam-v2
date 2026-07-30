import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { Deps } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireString } from '../registry.js'

export function createAuthHandlers(deps: Deps): HandlerRegistry {
  return {
    '/v1/auth/password-reset': async (_context, input) => {
      const email = requireString(input, 'email')
      await deps.firestore.collection('_passwordResetRequests').add({
        emailHash: createHash('sha256').update(email.trim().toLowerCase()).digest('hex'),
        status: 'queued', requestedAt: FieldValue.serverTimestamp(),
      })
      return { accepted: true, messageCode: 'REQUEST_ACCEPTED' }
    },
    // Invitation acceptance needs a token-hash field on the Invitation entity plus verification/activation
    // logic that does not exist anywhere in the codebase yet; deliberately not improvised here (see
    // docs/v2/P28A_ENDPOINT_COMMAND_MAP.md).
    '/v1/auth/invitations/accept': async () => {
      throw new Error('AUTH_INVITATION_ACCEPTANCE_NOT_CONFIGURED')
    },
  }
}

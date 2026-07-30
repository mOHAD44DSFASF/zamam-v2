import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { Deps } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireString } from '../registry.js'
import { createEmployeeService } from './employee.js'

export function createAuthHandlers(deps: Deps): HandlerRegistry {
  const employeeService = createEmployeeService(deps)

  return {
    '/v1/auth/password-reset': async (_context, input) => {
      const email = requireString(input, 'email')
      await deps.firestore.collection('_passwordResetRequests').add({
        emailHash: createHash('sha256').update(email.trim().toLowerCase()).digest('hex'),
        status: 'queued', requestedAt: FieldValue.serverTimestamp(),
      })
      return { accepted: true, messageCode: 'REQUEST_ACCEPTED' }
    },
    '/v1/auth/invitations/accept': (context, input) => employeeService.acceptInvitation({
      invitationToken: requireString(input, 'invitationToken'),
      password: requireString(input, 'password'),
      idempotencyKey: context.idempotencyKey,
      correlationId: context.correlationId,
    }),
  }
}

import { tenantCollectionPath } from '@zamam/firestore'
import { ClientService, type ClientLifecyclePort } from '../../client/service.js'
import { AesGcmClientDataProtectionAdapter } from '../../client/aes-data-protection.js'
import { EnvSecretProvider } from '../../platform/secrets.js'
import type { Deps } from '../deps.js'
import { listQuery } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireBoolean, requireNumber, requireString } from '../registry.js'

function createLifecyclePort(deps: Deps): ClientLifecyclePort {
  return {
    async listContacts(organizationId, clientId) {
      const snapshot = await deps.firestore.collection(tenantCollectionPath(organizationId, 'client_contact'))
        .where('clientId', '==', clientId).get()
      return snapshot.docs.map((doc) => ({
        id: doc.id, expectedVersion: Number(doc.data().version),
        ...(typeof doc.data().userId === 'string' ? { userId: String(doc.data().userId) } : {}),
      }))
    },
    async revokePortalIdentity() {},
  }
}

export function createClientHandlers(deps: Deps): HandlerRegistry {
  const protection = new AesGcmClientDataProtectionAdapter(new EnvSecretProvider())
  const service = new ClientService(deps.store, deps.authorization, protection, createLifecyclePort(deps))
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.create>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/clients/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'client.view', organizationId: context.organizationId })
      const page = await listQuery(deps, context.organizationId, 'client', {
        filters: [{ field: 'status', operator: 'in', value: ['lead', 'active', 'paused'] }],
        orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
      })
      return { items: page.items }
    },
    '/v1/clients/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), name: requireString(input, 'name'), code: requireString(input, 'code'),
      ...(typeof input.industry === 'string' ? { industry: input.industry } : {}),
      ...(typeof input.accountManagerUserId === 'string' ? { accountManagerUserId: input.accountManagerUserId } : {}),
    }),
    '/v1/clients/contacts/create': (context, input) => service.addContact(metadata(context), {
      id: requireString(input, 'id'), clientId: requireString(input, 'clientId'),
      name: requireString(input, 'name'), email: requireString(input, 'email'),
      clientAdmin: typeof input.clientAdmin === 'boolean' ? input.clientAdmin : false,
    }),
    '/v1/clients/contacts/eligibility': (context, input) => service.setPortalEligibility(
      metadata(context), requireString(input, 'clientId'), requireString(input, 'contactId'),
      requireNumber(input, 'expectedVersion'), requireBoolean(input, 'eligible'),
    ),
  }
}

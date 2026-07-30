import { tenantDocumentPath } from '@zamam/firestore'
import { NotificationCommandService, buildNotificationInboxQuery, type NotificationLookupPort } from '../../notification/service.js'
import type { Deps } from '../deps.js'
import { readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createLookupPort(deps: Deps): NotificationLookupPort {
  return { get: (organizationId, notificationId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'notification', notificationId)) }
}

export function createNotificationHandlers(deps: Deps): HandlerRegistry {
  const service = new NotificationCommandService(deps.store, deps.authorization, createLookupPort(deps))
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.setStatus>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/notifications/query': async (context, input) => {
      await deps.authorization.require(context.principal, {
        permission: 'notification.view', organizationId: context.organizationId,
        resource: { type: 'user', id: context.principal.userId, organizationId: context.organizationId, ownerUserId: context.principal.userId, visibility: 'restricted' },
      })
      const query = buildNotificationInboxQuery({
        organizationId: context.organizationId, recipientUserId: context.principal.userId,
        ...(typeof input.status === 'string' ? { status: input.status as 'unread' | 'read' } : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/notification`, query)
      return { items: page.items, nextCursor: page.nextCursor }
    },
    '/v1/notifications/status': (context, input) => service.setStatus(
      metadata(context), requireString(input, 'notificationId'), requireNumber(input, 'expectedVersion'),
      requireString(input, 'status') as 'read' | 'archived',
    ),
    '/v1/notifications/preferences/update': (context, input) => service.updatePreference(metadata(context), {
      eventType: requireString(input, 'eventType'),
      inApp: typeof input.inApp === 'boolean' ? input.inApp : true, email: typeof input.email === 'boolean' ? input.email : true,
      digest: requireString(input, 'digest') as 'immediate' | 'daily' | 'weekly' | 'never', timezone: requireString(input, 'timezone'),
      ...(typeof input.quietHoursStart === 'string' ? { quietHoursStart: input.quietHoursStart } : {}),
      ...(typeof input.quietHoursEnd === 'string' ? { quietHoursEnd: input.quietHoursEnd } : {}),
      ...(typeof input.expectedVersion === 'number' ? { expectedVersion: input.expectedVersion } : {}),
    }),
  }
}

import { appCheckHeaders, auth } from '../../lib/firebase'

export interface NotificationSummary {
  id: string
  title: string
  preview: string
  status: 'unread' | 'read'
  critical: boolean
  createdAt: string
  resourceType: string | null
  resourceId: string | null
  version: number
}
export interface NotificationPreferenceSummary {
  eventType: string
  label: string
  critical: boolean
  inApp: boolean
  email: boolean
  digest: 'immediate' | 'daily' | 'weekly' | 'never'
  timezone: string
  quietHoursStart: string
  quietHoursEnd: string
  version: number | null
}
export interface NotificationSnapshot {
  notifications: readonly NotificationSummary[]
  preferences: readonly NotificationPreferenceSummary[]
  emailProvider: { name: string; configured: boolean }
  capabilities: { managePreferences: boolean }
}
export interface NotificationClient {
  load(organizationId: string, status: 'all' | 'unread' | 'read'): Promise<NotificationSnapshot>
  setStatus(
    organizationId: string, notificationId: string, expectedVersion: number,
    status: 'read' | 'archived',
  ): Promise<void>
  updatePreference(
    organizationId: string, preference: NotificationPreferenceSummary,
  ): Promise<void>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL
  const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
      'x-idempotency-key': crypto.randomUUID(),
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) {
    throw new Error(envelope.error?.code ?? 'NOTIFICATION_REQUEST_FAILED')
  }
  return envelope.data
}
export const notificationClient: NotificationClient = {
  load: (organizationId, status) =>
    post('/v1/notifications/query', { organizationId, status, limit: 50 }),
  setStatus: (organizationId, notificationId, expectedVersion, status) =>
    post('/v1/notifications/status', {
      organizationId, notificationId, expectedVersion, status,
    }),
  updatePreference: (organizationId, preference) =>
    post('/v1/notifications/preferences/update', {
      organizationId, eventType: preference.eventType,
      inApp: preference.inApp, email: preference.email, digest: preference.digest,
      timezone: preference.timezone,
      ...(preference.quietHoursStart ? { quietHoursStart: preference.quietHoursStart } : {}),
      ...(preference.quietHoursEnd ? { quietHoursEnd: preference.quietHoursEnd } : {}),
      ...(preference.version ? { expectedVersion: preference.version } : {}),
    }),
}

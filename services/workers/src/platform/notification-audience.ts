import { createHash } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import type { OutboxEvent } from '@zamam/domain'
import type { NotificationAudiencePort, NotificationPreferencePort, NotificationRecipient } from '../notification-projection.js'

const tenantPath = (organizationId: string, kind: string, id: string) => `v2Organizations/${organizationId}/${kind}/${id}`
const id = /^[A-Za-z0-9_-]{2,128}$/

// v1 simplification: the audience is every user id found in a fixed set of well-known payload fields
// (already written by the existing, tested *Service classes — see AuditCommandService callers), not a
// bespoke per-event-type resolver. No existing audience-resolution algorithm existed to reuse.
const CANDIDATE_FIELDS = ['assigneeUserId', 'reviewerUserIds', 'mentionedUserIds', 'approverUserId', 'requestedBy', 'createdBy', 'userId'] as const

function candidateUserIds(event: OutboxEvent): readonly string[] {
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Readonly<Record<string, unknown>> : {}
  const ids = new Set<string>()
  for (const field of CANDIDATE_FIELDS) {
    const value = payload[field]
    if (typeof value === 'string' && id.test(value)) ids.add(value)
    if (Array.isArray(value)) for (const item of value) if (typeof item === 'string' && id.test(item)) ids.add(item)
  }
  if (event.actorUserId) ids.delete(event.actorUserId)
  return [...ids].slice(0, 100)
}

export function createFirestoreNotificationAudiencePort(firestore: Firestore): NotificationAudiencePort {
  return {
    async resolve(event) {
      if (!event.organizationId) return []
      const organizationId = event.organizationId
      const userIds = candidateUserIds(event)
      const recipients = await Promise.all(userIds.map(async (userId): Promise<NotificationRecipient> => {
        const [membership, profile] = await Promise.all([
          firestore.doc(tenantPath(organizationId, 'organization_membership', userId)).get(),
          firestore.doc(tenantPath(organizationId, 'user_profile', userId)).get(),
        ])
        return {
          userId, locale: profile.exists && profile.data()?.locale === 'en' ? 'en' : 'ar',
          timezone: profile.exists && typeof profile.data()?.timezone === 'string' ? String(profile.data()!.timezone) : 'UTC',
          visibility: 'internal',
          active: membership.exists && membership.data()?.status === 'active',
          canAccess: membership.exists,
        }
      }))
      return recipients
    },
  }
}

export function createFirestoreNotificationPreferencePort(firestore: Firestore): NotificationPreferencePort {
  return {
    async get(organizationId, userId, eventType) {
      const preferenceId = `preference-${createHash('sha256').update(`${userId}:${eventType}`).digest('hex').slice(0, 40)}`
      const snapshot = await firestore.doc(tenantPath(organizationId, 'notification_preference', preferenceId)).get()
      return snapshot.exists ? snapshot.data()! : null
    },
  }
}

import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { NotificationDeliveryStore, NotificationDeliveryWorkItem } from '../notification-delivery.js'

const path = (organizationId: string, deliveryId: string) => `v2Organizations/${organizationId}/notification_delivery/${deliveryId}`

export function createFirestoreNotificationDeliveryStore(firestore: Firestore, organizationId: string): NotificationDeliveryStore {
  return {
    async claim(id, expectedVersion, claimedAt) {
      const ref = firestore.doc(path(organizationId, id))
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return false
        const data = snapshot.data()!
        if (data.status !== 'pending' || Number(data.version) !== expectedVersion) return false
        transaction.update(ref, { status: 'processing', claimedAt, version: expectedVersion + 1, updatedAt: FieldValue.serverTimestamp() })
        return true
      })
    },
    async markDelivered(ids, providerMessageId, deliveredAt) {
      await Promise.all(ids.map((id) => firestore.doc(path(organizationId, id)).update({
        status: 'delivered', providerMessageId, deliveredAt, updatedAt: FieldValue.serverTimestamp(),
      })))
    },
    async scheduleRetry(id, attemptCount, availableAt, errorCode) {
      await firestore.doc(path(organizationId, id)).update({
        status: 'pending', attemptCount, availableAt: Timestamp.fromDate(new Date(availableAt)),
        lastErrorCode: errorCode, updatedAt: FieldValue.serverTimestamp(),
      })
    },
    async moveToDeadLetter(id, attemptCount, errorCode) {
      await firestore.doc(path(organizationId, id)).update({
        status: 'dead_letter', attemptCount, lastErrorCode: errorCode, updatedAt: FieldValue.serverTimestamp(),
      })
    },
  }
}

export interface DueNotificationDeliveryBatch { organizationId: string; items: readonly NotificationDeliveryWorkItem[] }

export async function findDueNotificationDeliveries(firestore: Firestore, now: Date, limit = 50): Promise<readonly DueNotificationDeliveryBatch[]> {
  const snapshot = await firestore.collectionGroup('notification_delivery')
    .where('status', '==', 'pending')
    .where('availableAt', '<=', Timestamp.fromDate(now))
    .orderBy('availableAt', 'asc')
    .limit(limit)
    .get()
  const byOrg = new Map<string, NotificationDeliveryWorkItem[]>()
  for (const doc of snapshot.docs) {
    const data = doc.data()
    const organizationId = String(data.organizationId ?? '')
    if (!organizationId) continue
    const item: NotificationDeliveryWorkItem = {
      id: doc.id, organizationId, notificationId: String(data.notificationId),
      recipientUserId: String(data.recipientUserId), locale: data.locale === 'en' ? 'en' : 'ar',
      digest: data.digest === 'daily' || data.digest === 'weekly' ? data.digest : 'immediate',
      critical: data.critical === true, attemptCount: Number(data.attemptCount ?? 0), version: Number(data.version ?? 1),
    }
    byOrg.set(organizationId, [...(byOrg.get(organizationId) ?? []), item])
  }
  return [...byOrg.entries()].map(([organizationId, items]) => ({ organizationId, items }))
}

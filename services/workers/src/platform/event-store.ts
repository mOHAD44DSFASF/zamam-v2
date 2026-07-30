import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { OutboxEvent } from '@zamam/domain'
import type { EventDeliveryStore } from '../worker.js'

const outboxPath = (organizationId: string, eventId: string) =>
  `v2Organizations/${organizationId}/_outboxEvents/${eventId}`

function decodeEvent(id: string, data: FirebaseFirestore.DocumentData): OutboxEvent {
  return {
    id,
    type: String(data.type),
    version: Number(data.eventVersion ?? data.version ?? 1),
    organizationId: typeof data.organizationId === 'string' ? data.organizationId : null,
    actorUserId: typeof data.actorUserId === 'string' ? data.actorUserId : null,
    correlationId: String(data.correlationId ?? ''),
    idempotencyKey: String(data.idempotencyKey ?? ''),
    payload: data.payload,
    status: (data.status ?? 'pending') as OutboxEvent['status'],
    attemptCount: Number(data.attemptCount ?? 0),
    availableAt: data.availableAt instanceof Timestamp ? data.availableAt.toDate().toISOString() : String(data.availableAt ?? ''),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : String(data.createdAt ?? ''),
    ...(typeof data.processedAt === 'string' ? { processedAt: data.processedAt } : {}),
    ...(typeof data.lastErrorCode === 'string' ? { lastErrorCode: data.lastErrorCode } : {}),
  }
}

/** Loads a single outbox event by (organizationId, eventId) — the transport envelope carries both. */
export async function loadOutboxEvent(firestore: Firestore, organizationId: string, eventId: string): Promise<OutboxEvent | null> {
  const snapshot = await firestore.doc(outboxPath(organizationId, eventId)).get()
  if (!snapshot.exists) return null
  return decodeEvent(snapshot.id, snapshot.data()!)
}

/** Optimistic claim: moves a due event from pending/retry into processing so concurrent deliveries don't double-run a handler. */
export async function claimOutboxEvent(firestore: Firestore, organizationId: string, eventId: string, now: Date): Promise<boolean> {
  const ref = firestore.doc(outboxPath(organizationId, eventId))
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return false
    const data = snapshot.data()!
    if (data.status !== 'pending' && data.status !== 'failed') return false
    const availableAt = data.availableAt instanceof Timestamp ? data.availableAt.toMillis() : Date.parse(String(data.availableAt))
    if (Number.isFinite(availableAt) && availableAt > now.getTime()) return false
    transaction.update(ref, { status: 'processing', claimedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return true
  })
}

/** Bound to a single (organizationId, eventId) pair — processOutboxEvent() has no per-call org context, so one of these is created per event. */
export function createFirestoreEventDeliveryStore(firestore: Firestore, organizationId: string): EventDeliveryStore {
  const ref = (eventId: string) => firestore.doc(outboxPath(organizationId, eventId))
  return {
    async wasCompleted(eventId) {
      const snapshot = await ref(eventId).get()
      return snapshot.exists && snapshot.data()?.status === 'completed'
    },
    async markCompleted(eventId, processedAt) {
      await ref(eventId).update({ status: 'completed', processedAt, updatedAt: FieldValue.serverTimestamp() })
    },
    async scheduleRetry(eventId, attemptCount, availableAt, errorCode) {
      await ref(eventId).update({
        status: 'pending', attemptCount, availableAt: Timestamp.fromDate(new Date(availableAt)),
        lastErrorCode: errorCode, updatedAt: FieldValue.serverTimestamp(),
      })
    },
    async moveToDeadLetter(eventId, attemptCount, errorCode) {
      await ref(eventId).update({
        status: 'dead_letter', attemptCount, lastErrorCode: errorCode, updatedAt: FieldValue.serverTimestamp(),
      })
    },
  }
}

export interface DueOutboxBatch { eventId: string; organizationId: string }

/** Reconciliation sweep: finds events due now that are not yet completed/dead-lettered, across every organization. */
export async function findDueOutboxEvents(firestore: Firestore, now: Date, limit = 50): Promise<readonly DueOutboxBatch[]> {
  const snapshot = await firestore.collectionGroup('_outboxEvents')
    .where('status', '==', 'pending')
    .where('availableAt', '<=', Timestamp.fromDate(now))
    .orderBy('availableAt', 'asc')
    .limit(limit)
    .get()
  return snapshot.docs
    .map((doc) => ({ eventId: doc.id, organizationId: String(doc.data().organizationId ?? '') }))
    .filter((item) => item.organizationId.length > 0)
}

export class InMemoryEventDeliveryStore implements EventDeliveryStore {
  private readonly records = new Map<string, { status: OutboxEvent['status']; attemptCount: number; availableAt: string }>()

  seed(event: OutboxEvent) {
    this.records.set(event.id, { status: event.status, attemptCount: event.attemptCount, availableAt: event.availableAt })
  }

  due(now: Date) {
    return [...this.records.entries()]
      .filter(([, record]) => record.status === 'pending' && Date.parse(record.availableAt) <= now.getTime())
      .map(([eventId]) => eventId)
  }

  async claim(eventId: string) {
    const record = this.records.get(eventId)
    if (!record || (record.status !== 'pending' && record.status !== 'failed')) return false
    record.status = 'processing'
    return true
  }

  async wasCompleted(eventId: string) { return this.records.get(eventId)?.status === 'completed' }
  async markCompleted(eventId: string) {
    const record = this.records.get(eventId)
    if (record) record.status = 'completed'
  }
  async scheduleRetry(eventId: string, attemptCount: number, availableAt: string) {
    const record = this.records.get(eventId)
    if (record) { record.status = 'pending'; record.attemptCount = attemptCount; record.availableAt = availableAt }
  }
  async moveToDeadLetter(eventId: string, attemptCount: number) {
    const record = this.records.get(eventId)
    if (record) { record.status = 'dead_letter'; record.attemptCount = attemptCount }
  }
}

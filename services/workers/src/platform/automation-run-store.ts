import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { AutomationRunStore } from '../automation-run.js'

const runPath = (organizationId: string, runId: string) => `v2Organizations/${organizationId}/automation_run/${runId}`
const quotaPath = (organizationId: string, automationId: string, windowStart: number) =>
  `v2Organizations/${organizationId}/_automationQuota/${automationId}-${windowStart}`

/** Scoped to a single organizationId, resolved once the triggering event's org is known (mirrors event-store.ts). */
export function createScopedFirestoreAutomationRunStore(firestore: Firestore, organizationId: string, now: () => Date = () => new Date()): AutomationRunStore {
  const ref = (runId: string) => firestore.doc(runPath(organizationId, runId))
  return {
    async begin(runId, item) {
      return firestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(ref(runId))
        if (existing.exists) return 'duplicate'
        transaction.create(ref(runId), {
          organizationId, schemaVersion: 1, version: 1,
          automationId: item.automationId, automationVersion: item.automationVersion,
          triggerEventId: item.triggerEventId, status: 'running', attemptCount: item.attemptCount,
          actionResults: [], startedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        })
        return 'created'
      })
    },
    async complete(runId, results) {
      await ref(runId).update({
        status: 'completed', actionResults: results, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
    },
    async retry(runId, attempt, code) {
      await ref(runId).update({ status: 'retrying', attemptCount: attempt, errorCode: code, updatedAt: FieldValue.serverTimestamp() })
    },
    async deadLetter(runId, attempt, code) {
      await ref(runId).update({ status: 'dead_letter', attemptCount: attempt, errorCode: code, updatedAt: FieldValue.serverTimestamp() })
    },
    async quota(orgId, automationId, limit) {
      const windowStart = Math.floor(now().getTime() / 3_600_000) * 3_600_000
      const ref2 = firestore.doc(quotaPath(orgId, automationId, windowStart))
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref2)
        const count = snapshot.exists ? Number(snapshot.data()?.count ?? 0) : 0
        if (count >= limit) return false
        if (snapshot.exists) transaction.update(ref2, { count: count + 1, updatedAt: FieldValue.serverTimestamp() })
        else transaction.create(ref2, {
          organizationId: orgId, automationId, count: 1, windowStart: Timestamp.fromMillis(windowStart),
          expiresAt: Timestamp.fromMillis(windowStart + 7_200_000), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        })
        return true
      })
    },
  }
}

import { FirebaseAtomicStore } from '@zamam/firestore'
import { NotificationDeliveryJob, type NotificationRecipientDirectory } from './notification-delivery.js'
import { dispatchEvent, type DispatchDeps } from './dispatch.js'
import { claimOutboxEvent, createFirestoreEventDeliveryStore, findDueOutboxEvents, loadOutboxEvent } from './platform/event-store.js'
import { findDueNotificationDeliveries } from './platform/notification-delivery-store.js'
import { createFirestoreEscalationRecipientPort, createFirestoreStalledTaskLookupPort } from './platform/stalled-task-escalation-ports.js'
import { StalledTaskEscalationService, type StalledTaskEscalationResult } from './stalled-task-escalation.js'
import { createFirestoreDigestContentPort, createFirestoreDigestRecipientPort } from './platform/daily-digest-ports.js'
import { DailyDigestService, type DailyDigestResult } from './daily-digest.js'
import type { WorkerRuntime } from './compose.js'

export interface OutboxReconcileResult { scanned: number; completed: number; retried: number; deadLettered: number; alreadyCompleted: number; skipped: number }

export async function reconcileOutbox(runtime: WorkerRuntime, limit = 50): Promise<OutboxReconcileResult> {
  const due = await findDueOutboxEvents(runtime.firestore, runtime.now(), limit)
  const result: OutboxReconcileResult = { scanned: due.length, completed: 0, retried: 0, deadLettered: 0, alreadyCompleted: 0, skipped: 0 }
  const dispatchDeps: DispatchDeps = {
    firestore: runtime.firestore, handlers: runtime.handlers, automationExecutor: runtime.automationExecutor,
    logger: runtime.logger, now: runtime.now,
  }
  for (const { eventId, organizationId } of due) {
    const claimed = await claimOutboxEvent(runtime.firestore, organizationId, eventId, runtime.now())
    if (!claimed) { result.skipped += 1; continue }
    const event = await loadOutboxEvent(runtime.firestore, organizationId, eventId)
    if (!event) { result.skipped += 1; continue }
    const store = createFirestoreEventDeliveryStore(runtime.firestore, organizationId)
    const outcome = await dispatchEvent(event, dispatchDeps, store)
    if (outcome.status === 'completed') result.completed += 1
    else if (outcome.status === 'already_completed') result.alreadyCompleted += 1
    else if (outcome.status === 'retry_scheduled') result.retried += 1
    else result.deadLettered += 1
  }
  return result
}

/** Part 3A — one organization per call (mirrors every other org-scoped service in this codebase; see
 * stalled-task-escalation.ts's own doc comment for why no cross-org scheduler exists yet). */
export async function escalateStalledTasks(runtime: WorkerRuntime, organizationId: string): Promise<StalledTaskEscalationResult> {
  const service = new StalledTaskEscalationService(
    new FirebaseAtomicStore(runtime.firestore), createFirestoreStalledTaskLookupPort(runtime.firestore),
    createFirestoreEscalationRecipientPort(runtime.firestore), { now: () => runtime.now().toISOString() },
  )
  return service.scan(organizationId)
}

/** Part 3B — same one-organization-per-call shape as escalateStalledTasks() above. */
export async function sendDailyDigests(runtime: WorkerRuntime, organizationId: string): Promise<DailyDigestResult> {
  const service = new DailyDigestService(
    new FirebaseAtomicStore(runtime.firestore), createFirestoreDigestRecipientPort(runtime.firestore),
    createFirestoreDigestContentPort(runtime.firestore), { now: () => runtime.now().toISOString() },
  )
  return service.scan(organizationId)
}

export interface NotificationDeliveryReconcileResult { organizations: number; delivered: number; retried: number; deadLettered: number }

export async function reconcileNotificationDeliveries(
  runtime: WorkerRuntime, directory: NotificationRecipientDirectory, appBaseUrl: string, limit = 50,
): Promise<NotificationDeliveryReconcileResult> {
  const batches = await findDueNotificationDeliveries(runtime.firestore, runtime.now(), limit)
  const result: NotificationDeliveryReconcileResult = { organizations: batches.length, delivered: 0, retried: 0, deadLettered: 0 }
  for (const batch of batches) {
    const store = runtime.notificationDeliveryStore(batch.organizationId)
    const job = new NotificationDeliveryJob(store, directory, runtime.emailProvider, appBaseUrl, runtime.now)
    const outcome = await job.run(batch.items)
    result.delivered += outcome.delivered
    result.retried += outcome.retried
    result.deadLettered += outcome.deadLettered
  }
  return result
}

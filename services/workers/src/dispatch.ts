import type { Firestore } from 'firebase-admin/firestore'
import type { OutboxEvent } from '@zamam/domain'
import type { createLogger } from '@zamam/observability'
import { AutomationRunJob, type AutomationActionExecutor, type AutomationWorkItem } from './automation-run.js'
import { createScopedFirestoreAutomationRunStore } from './platform/automation-run-store.js'
import { processOutboxEvent, type EventDeliveryStore, type EventHandler, type EventProcessingResult } from './worker.js'

/**
 * Matches an outbox event against every active automation configured to trigger on its exact event
 * type, and runs each match. Deliberately NOT expressed as an entry in the eventType→handler registry
 * (worker.ts's processOutboxEvent picks at most one handler per type) because automations are
 * user-configured per organization and can target ANY event type, including ones notifications/files/
 * reports also care about. Each run has its own idempotency (deterministic runId) and retry/dead-letter
 * bookkeeping via AutomationRunStore, independent of the primary event's own delivery state — a failed
 * automation match never blocks or dead-letters the primary event.
 */
export async function matchAndRunAutomations(
  firestore: Firestore, event: OutboxEvent, executor: AutomationActionExecutor,
  logger: ReturnType<typeof createLogger>, maxAutomationsPerEvent = 20,
): Promise<void> {
  if (!event.organizationId) return
  const organizationId = event.organizationId
  const snapshot = await firestore.collection(`v2Organizations/${organizationId}/automation`)
    .where('triggerType', '==', event.type).where('status', '==', 'active').limit(maxAutomationsPerEvent).get()
  if (snapshot.empty) return
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Readonly<Record<string, unknown>> : {}
  const store = createScopedFirestoreAutomationRunStore(firestore, organizationId)
  for (const doc of snapshot.docs) {
    const data = doc.data()
    const item: AutomationWorkItem = {
      organizationId, automationId: doc.id, automationVersion: Number(data.definitionVersion ?? 1),
      triggerEventId: event.id, triggerDepth: 0,
      conditions: Array.isArray(data.conditions) ? data.conditions : [],
      actions: Array.isArray(data.actions) ? data.actions : [],
      payload, servicePrincipalId: String(data.servicePrincipalId ?? ''),
      scopeType: String(data.scopeType ?? 'organization'), scopeId: String(data.scopeId ?? organizationId),
      attemptCount: 0,
    }
    const job = new AutomationRunJob(store, executor)
    try {
      await job.run(item)
    } catch (error) {
      logger.warn('worker.automation.match_failed', event.correlationId, {
        automationId: doc.id, eventId: event.id,
        code: error instanceof Error ? error.message : 'AUTOMATION_MATCH_FAILED',
      })
    }
  }
}

export interface DispatchDeps {
  firestore: Firestore
  handlers: readonly EventHandler[]
  automationExecutor: AutomationActionExecutor
  logger: ReturnType<typeof createLogger>
  now: () => Date
}

/** The full per-event pipeline shared by the push endpoint and the reconciliation sweep. */
export async function dispatchEvent(
  event: OutboxEvent, deps: DispatchDeps, store: EventDeliveryStore,
): Promise<EventProcessingResult> {
  await matchAndRunAutomations(deps.firestore, event, deps.automationExecutor, deps.logger)
  return processOutboxEvent(event, deps.handlers, store, deps.logger, deps.now)
}

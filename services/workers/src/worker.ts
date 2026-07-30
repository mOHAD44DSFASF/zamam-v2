import type { OutboxEvent } from '@zamam/domain'
import type { createLogger } from '@zamam/observability'

export interface EventHandler {
  eventType: string
  handle(event: OutboxEvent): Promise<void>
}

export interface EventDeliveryStore {
  wasCompleted(eventId: string): Promise<boolean>
  markCompleted(eventId: string, processedAt: string): Promise<void>
  scheduleRetry(eventId: string, attemptCount: number, availableAt: string, errorCode: string): Promise<void>
  moveToDeadLetter(eventId: string, attemptCount: number, errorCode: string): Promise<void>
}

export type EventProcessingResult =
  | { status: 'completed' | 'already_completed' }
  | { status: 'retry_scheduled'; availableAt: string }
  | { status: 'dead_letter' }

function errorCode(error: unknown) {
  return error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message) ? error.message : 'EVENT_HANDLER_FAILED'
}

export async function processOutboxEvent(
  event: OutboxEvent,
  handlers: readonly EventHandler[],
  store: EventDeliveryStore,
  logger: ReturnType<typeof createLogger>,
  now: () => Date = () => new Date(),
  maxAttempts = 8,
): Promise<EventProcessingResult> {
  if (await store.wasCompleted(event.id)) return { status: 'already_completed' }
  const handler = handlers.find((candidate) => candidate.eventType === event.type)
  if (!handler) {
    await store.moveToDeadLetter(event.id, event.attemptCount + 1, 'EVENT_HANDLER_NOT_FOUND')
    return { status: 'dead_letter' }
  }

  try {
    await handler.handle(event)
    await store.markCompleted(event.id, now().toISOString())
    logger.info('worker.event.completed', event.correlationId, { eventId: event.id, eventType: event.type })
    return { status: 'completed' }
  } catch (error) {
    const attempt = event.attemptCount + 1
    const code = errorCode(error)
    logger.warn('worker.event.failed', event.correlationId, { eventId: event.id, eventType: event.type, attempt, code })
    if (attempt >= maxAttempts) {
      await store.moveToDeadLetter(event.id, attempt, code)
      return { status: 'dead_letter' }
    }
    const delaySeconds = Math.min(3_600, 2 ** attempt * 5)
    const availableAt = new Date(now().getTime() + delaySeconds * 1_000).toISOString()
    await store.scheduleRetry(event.id, attempt, availableAt, code)
    return { status: 'retry_scheduled', availableAt }
  }
}

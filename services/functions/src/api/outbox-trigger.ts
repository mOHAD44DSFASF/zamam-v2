import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { createLogger } from '@zamam/observability'
import {
  assertProductionTransportConfigured, DisabledWorkerTransportPublisher,
  LocalWorkerTransportPublisher, PubSubWorkerTransportPublisher,
  type TransportEnv, type WorkerTransportPublisher,
} from '@zamam/workers'
import { PubSub } from '@google-cloud/pubsub'

const logger = createLogger({ write: (record) => console.log(JSON.stringify(record)) })

function createPublisher(): WorkerTransportPublisher {
  const env = process.env as TransportEnv
  assertProductionTransportConfigured(env)
  if (!env.WORKER_PUBSUB_TOPIC || !env.GOOGLE_CLOUD_PROJECT) {
    return env.ZAMAM_ENV === 'production' ? new DisabledWorkerTransportPublisher() : new LocalWorkerTransportPublisher()
  }
  const topic = new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT }).topic(env.WORKER_PUBSUB_TOPIC)
  return new PubSubWorkerTransportPublisher(topic, env.WORKER_PUBSUB_TOPIC)
}

const publisher = createPublisher()

/**
 * Firestore trigger side of the transactional outbox: every command already writes its outbox record
 * atomically with its aggregate mutation (AuditCommandService, services/functions/src/audit/service.ts).
 * This function is the bridge from "outbox record exists" to "the worker gets told about it" — it does
 * not decide retry/dead-letter (that is Firestore state the worker owns) and republishing a duplicate
 * notification is safe: the worker claims the event before processing (services/workers/src/platform/
 * event-store.ts), so a redelivered or duplicate publish is a no-op.
 */
export const publishOutboxEvent = onDocumentCreated(
  'v2Organizations/{organizationId}/_outboxEvents/{eventId}',
  async (event) => {
    const organizationId = event.params.organizationId
    const eventId = event.params.eventId
    const data = event.data?.data()
    const correlationId = typeof data?.correlationId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.correlationId)
      ? data.correlationId : eventId
    try {
      await publisher.publish({ eventId, organizationId, correlationId })
    } catch (error) {
      logger.warn('outbox.publish_failed', correlationId, {
        eventId, organizationId, code: error instanceof Error ? error.message : 'PUBLISH_FAILED',
      })
    }
  },
)

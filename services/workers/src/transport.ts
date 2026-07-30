export interface WorkerTransportEnvelope {
  eventId: string
  organizationId: string
  correlationId: string
}

export interface WorkerTransportPublisher {
  readonly provider: string
  readonly configured: boolean
  publish(envelope: WorkerTransportEnvelope): Promise<void>
}

const MAX_ENVELOPE_BYTES = 4_096

function assertEnvelope(envelope: WorkerTransportEnvelope) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(envelope.eventId)) throw new Error('WORKER_TRANSPORT_ENVELOPE_INVALID')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(envelope.organizationId)) throw new Error('WORKER_TRANSPORT_ENVELOPE_INVALID')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(envelope.correlationId)) throw new Error('WORKER_TRANSPORT_ENVELOPE_INVALID')
  const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length
  if (bytes > MAX_ENVELOPE_BYTES) throw new Error('WORKER_TRANSPORT_ENVELOPE_TOO_LARGE')
}

/**
 * Deterministic, in-process transport for local development, unit/integration tests, and e2e/browser
 * smoke — the blueprint's Pub/Sub choice is a real network round-trip we should never depend on for
 * deterministic tests. When constructed with an `onMessage` handler, publish() delivers synchronously
 * (fully deterministic: no timers, no polling). Without one, envelopes queue in `pending` for a test to
 * drain explicitly via `drain()`.
 */
export class LocalWorkerTransportPublisher implements WorkerTransportPublisher {
  readonly provider = 'local'
  readonly configured = true
  readonly pending: WorkerTransportEnvelope[] = []
  constructor(private readonly onMessage?: (envelope: WorkerTransportEnvelope) => Promise<void>) {}

  async publish(envelope: WorkerTransportEnvelope) {
    assertEnvelope(envelope)
    if (this.onMessage) { await this.onMessage(envelope); return }
    this.pending.push(envelope)
  }

  async drain(handler: (envelope: WorkerTransportEnvelope) => Promise<void>) {
    const batch = this.pending.splice(0, this.pending.length)
    for (const envelope of batch) await handler(envelope)
    return batch.length
  }
}

export interface PubSubTopicPublisher {
  publishMessage(input: { data: Buffer; attributes: Record<string, string> }): Promise<string>
}

/**
 * Production-oriented adapter for the transport the V2 blueprint already selected
 * (docs/v2/API_AND_BACKEND_ARCHITECTURE.md §"Pub/Sub + Cloud Tasks": events, delayed/retry work).
 * Never falls back silently — construction throws `WORKER_TRANSPORT_NOT_CONFIGURED` if the topic is
 * missing, and `configured` reports the real state for health checks.
 */
export class PubSubWorkerTransportPublisher implements WorkerTransportPublisher {
  readonly provider = 'pubsub'
  readonly configured = true
  constructor(private readonly topic: PubSubTopicPublisher, private readonly topicName: string) {
    if (!/^[A-Za-z][A-Za-z0-9_.~+-]{2,254}$/.test(topicName)) throw new Error('WORKER_TRANSPORT_TOPIC_INVALID')
  }

  async publish(envelope: WorkerTransportEnvelope) {
    assertEnvelope(envelope)
    await this.topic.publishMessage({
      data: Buffer.from(JSON.stringify(envelope), 'utf8'),
      attributes: { eventId: envelope.eventId, organizationId: envelope.organizationId, correlationId: envelope.correlationId },
    })
  }
}

export class DisabledWorkerTransportPublisher implements WorkerTransportPublisher {
  readonly provider = 'disabled'
  readonly configured = false
  async publish(): Promise<never> { throw new Error('WORKER_TRANSPORT_NOT_CONFIGURED') }
}

export interface TransportEnv {
  ZAMAM_ENV?: string
  WORKER_TRANSPORT_PROVIDER?: string
  WORKER_PUBSUB_TOPIC?: string
  GOOGLE_CLOUD_PROJECT?: string
  FUNCTIONS_EMULATOR?: string
}

/**
 * Fails closed: in production mode with no Pub/Sub topic configured, this throws rather than silently
 * handing back an in-process transport that would drop work whenever the process restarts.
 */
export function assertProductionTransportConfigured(env: TransportEnv) {
  const isProduction = env.ZAMAM_ENV === 'production' && env.FUNCTIONS_EMULATOR !== 'true'
  if (!isProduction) return
  if (!env.WORKER_PUBSUB_TOPIC || !env.GOOGLE_CLOUD_PROJECT) throw new Error('WORKER_TRANSPORT_NOT_CONFIGURED')
}

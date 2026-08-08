import { z } from 'zod'
import { dispatchEvent, type DispatchDeps } from './dispatch.js'
import { claimOutboxEvent, createFirestoreEventDeliveryStore, loadOutboxEvent } from './platform/event-store.js'
import { createNotificationRecipientDirectory, type WorkerRuntime } from './compose.js'
import { escalateStalledTasks, reconcileNotificationDeliveries, reconcileOutbox, sendDailyDigests } from './reconcile.js'
import { getAuth } from 'firebase-admin/auth'

export interface WorkerHealth {
  status: 'ok'
  service: 'zamam-workers'
  transport: { provider: string; configured: boolean }
}

const MAX_BODY_BYTES = 16_384
const envelopeSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  organizationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  correlationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
}).strict()
const pushEnvelopeSchema = z.object({
  message: z.object({ data: z.string(), attributes: z.record(z.string(), z.string()).optional() }).passthrough(),
}).passthrough()

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

function unauthorized() {
  return json(401, { error: { code: 'WORKER_AUTHENTICATION_REQUIRED' } })
}

/** Pub/Sub push delivers {message:{data:base64,...}}; local/test callers may POST the envelope directly. */
function decodeEnvelope(rawBody: string): z.infer<typeof envelopeSchema> {
  const parsed: unknown = JSON.parse(rawBody)
  const push = pushEnvelopeSchema.safeParse(parsed)
  if (push.success) {
    const decoded: unknown = JSON.parse(Buffer.from(push.data.message.data, 'base64').toString('utf8'))
    return envelopeSchema.parse(decoded)
  }
  return envelopeSchema.parse(parsed)
}

async function readBoundedBody(request: Request): Promise<string> {
  const body = await request.text()
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) throw new Error('WORKER_REQUEST_TOO_LARGE')
  return body
}

function checkAuth(request: Request, sharedSecret: string | null) {
  if (!sharedSecret) return true
  const url = new URL(request.url)
  const provided = request.headers.get('x-worker-token') ?? url.searchParams.get('token')
  return provided === sharedSecret
}

export function createWorkerHttpHandler(runtime: WorkerRuntime) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname

    if (request.method === 'GET' && path === '/health') {
      const body: WorkerHealth = {
        status: 'ok', service: 'zamam-workers',
        transport: { provider: runtime.transport.provider, configured: runtime.transport.configured },
      }
      return json(200, body)
    }

    if (request.method !== 'POST') return json(404, { error: { code: 'NOT_FOUND' } })
    if (!checkAuth(request, runtime.sharedSecret)) return unauthorized()

    if (path === '/internal/events/process') {
      let rawBody: string
      try { rawBody = await readBoundedBody(request) } catch { return json(413, { error: { code: 'WORKER_REQUEST_TOO_LARGE' } }) }
      let envelope: z.infer<typeof envelopeSchema>
      try { envelope = decodeEnvelope(rawBody) } catch { return json(400, { error: { code: 'WORKER_ENVELOPE_INVALID' } }) }
      const claimed = await claimOutboxEvent(runtime.firestore, envelope.organizationId, envelope.eventId, runtime.now())
      if (!claimed) return json(200, { status: 'skipped' })
      const event = await loadOutboxEvent(runtime.firestore, envelope.organizationId, envelope.eventId)
      if (!event) return json(200, { status: 'skipped' })
      const store = createFirestoreEventDeliveryStore(runtime.firestore, envelope.organizationId)
      const dispatchDeps: DispatchDeps = {
        firestore: runtime.firestore, handlers: runtime.handlers, automationExecutor: runtime.automationExecutor,
        logger: runtime.logger, now: runtime.now,
      }
      // Always ack (2xx): our own retry/dead-letter state lives in Firestore (availableAt + attemptCount),
      // driven by the reconciliation sweep — not by Pub/Sub's redelivery, which would race our own backoff.
      const outcome = await dispatchEvent(event, dispatchDeps, store)
      return json(200, { status: outcome.status })
    }

    if (path === '/internal/scheduled/reconcile-outbox') {
      const result = await reconcileOutbox(runtime)
      return json(200, result)
    }

    if (path === '/internal/scheduled/notification-delivery') {
      const directory = createNotificationRecipientDirectory(runtime.firestore, getAuth())
      const result = await reconcileNotificationDeliveries(runtime, directory, process.env.ZAMAM_APP_BASE_URL ?? 'https://localhost')
      return json(200, result)
    }

    if (path === '/internal/scheduled/escalate-stalled-tasks') {
      let rawBody: string
      try { rawBody = await readBoundedBody(request) } catch { return json(413, { error: { code: 'WORKER_REQUEST_TOO_LARGE' } }) }
      const parsed = z.object({ organizationId: z.string().regex(/^[A-Za-z0-9_-]{2,128}$/) }).safeParse(JSON.parse(rawBody || '{}'))
      if (!parsed.success) return json(400, { error: { code: 'ORGANIZATION_ID_REQUIRED' } })
      const result = await escalateStalledTasks(runtime, parsed.data.organizationId)
      return json(200, result)
    }

    if (path === '/internal/scheduled/send-daily-digests') {
      let rawBody: string
      try { rawBody = await readBoundedBody(request) } catch { return json(413, { error: { code: 'WORKER_REQUEST_TOO_LARGE' } }) }
      const parsed = z.object({ organizationId: z.string().regex(/^[A-Za-z0-9_-]{2,128}$/) }).safeParse(JSON.parse(rawBody || '{}'))
      if (!parsed.success) return json(400, { error: { code: 'ORGANIZATION_ID_REQUIRED' } })
      const result = await sendDailyDigests(runtime, parsed.data.organizationId)
      return json(200, result)
    }

    return json(404, { error: { code: 'NOT_FOUND' } })
  }
}

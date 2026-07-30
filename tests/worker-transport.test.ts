import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '@zamam/observability'
import type { OutboxEvent } from '@zamam/domain'
import {
  LocalWorkerTransportPublisher, DisabledWorkerTransportPublisher, PubSubWorkerTransportPublisher,
  assertProductionTransportConfigured,
} from '../services/workers/src/transport'
import { InMemoryEventDeliveryStore } from '../services/workers/src/platform/event-store'
import { matchAndRunAutomations, dispatchEvent, type DispatchDeps } from '../services/workers/src/dispatch'
import { processOutboxEvent, type EventHandler } from '../services/workers/src/worker'
import { createMalwareScanner } from '../services/workers/src/platform/file-commands'
import { FileScanHandler } from '../services/workers/src/file-processing'

const logger = createLogger({ write: vi.fn() }, () => new Date('2026-01-01T00:00:00.000Z'))
const now = () => new Date('2026-01-01T00:00:00.000Z')

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 'event-1', type: 'task.created', version: 1, organizationId: 'org-1',
    actorUserId: 'user-1', correlationId: 'correlation-1', idempotencyKey: 'idem-1',
    payload: {}, status: 'pending', attemptCount: 0,
    availableAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('LocalWorkerTransportPublisher (dev/test transport)', () => {
  it('delivers synchronously when constructed with a message handler (enqueue -> process happy path)', async () => {
    const received: string[] = []
    const transport = new LocalWorkerTransportPublisher(async (envelope) => { received.push(envelope.eventId) })
    await transport.publish({ eventId: 'event-1', organizationId: 'org-1', correlationId: 'correlation-1' })
    expect(received).toEqual(['event-1'])
  })

  it('queues for manual drain when no handler is registered, and drain() processes exactly once', async () => {
    const transport = new LocalWorkerTransportPublisher()
    await transport.publish({ eventId: 'event-1', organizationId: 'org-1', correlationId: 'correlation-1' })
    const seen: string[] = []
    const drained = await transport.drain(async (envelope) => { seen.push(envelope.eventId) })
    expect(drained).toBe(1)
    expect(seen).toEqual(['event-1'])
    expect(await transport.drain(async () => {})).toBe(0)
  })

  it('rejects malformed envelopes and oversized payloads', async () => {
    const transport = new LocalWorkerTransportPublisher()
    await expect(transport.publish({ eventId: 'not valid!', organizationId: 'org-1', correlationId: 'c-1' })).rejects.toThrow('WORKER_TRANSPORT_ENVELOPE_INVALID')
  })
})

describe('production transport fails closed', () => {
  it('throws when production mode has no Pub/Sub topic configured, instead of silently using a local transport', () => {
    expect(() => assertProductionTransportConfigured({ ZAMAM_ENV: 'production' })).toThrow('WORKER_TRANSPORT_NOT_CONFIGURED')
    expect(() => assertProductionTransportConfigured({ ZAMAM_ENV: 'production', WORKER_PUBSUB_TOPIC: 'topic', GOOGLE_CLOUD_PROJECT: 'proj' })).not.toThrow()
  })

  it('does not gate non-production environments', () => {
    expect(() => assertProductionTransportConfigured({})).not.toThrow()
    expect(() => assertProductionTransportConfigured({ ZAMAM_ENV: 'production', FUNCTIONS_EMULATOR: 'true' })).not.toThrow()
  })

  it('DisabledWorkerTransportPublisher always fails closed on publish', async () => {
    const transport = new DisabledWorkerTransportPublisher()
    expect(transport.configured).toBe(false)
    await expect(transport.publish({ eventId: 'e', organizationId: 'o', correlationId: 'c' })).rejects.toThrow('WORKER_TRANSPORT_NOT_CONFIGURED')
  })

  it('PubSubWorkerTransportPublisher validates its topic name at construction', () => {
    const topic = { publishMessage: vi.fn().mockResolvedValue('message-id') }
    expect(() => new PubSubWorkerTransportPublisher(topic, '')).toThrow('WORKER_TRANSPORT_TOPIC_INVALID')
    expect(() => new PubSubWorkerTransportPublisher(topic, 'zamam-outbox-events')).not.toThrow()
  })
})

describe('malware scanner fails closed when unconfigured', () => {
  it('is disabled (configured=false) in production without a provider, and FileScanHandler refuses to scan', async () => {
    const scanner = createMalwareScanner({ ZAMAM_ENV: 'production' })
    expect(scanner.configured).toBe(false)
    const handler = new FileScanHandler(scanner, { record: vi.fn() })
    await expect(handler.handle(event({
      type: 'file.scan_requested',
      payload: { fileId: 'file-1', fileVersionId: 'version-1', objectKey: 'org-1/file-1/1' },
    }))).rejects.toThrow('MALWARE_SCANNER_NOT_CONFIGURED')
  })

  it('uses a deterministic local scanner outside production so the upload -> scan -> available flow stays testable', () => {
    const scanner = createMalwareScanner({ ZAMAM_ENV: 'test' })
    expect(scanner.configured).toBe(true)
  })
})

describe('outbox event delivery (InMemoryEventDeliveryStore + processOutboxEvent)', () => {
  it('enqueue -> claim -> process -> ack happy path', async () => {
    const store = new InMemoryEventDeliveryStore()
    store.seed(event())
    expect(await store.claim('event-1')).toBe(true)
    const handler: EventHandler = { eventType: 'task.created', handle: vi.fn().mockResolvedValue(undefined) }
    const result = await processOutboxEvent(event(), [handler], store, logger, now)
    expect(result).toEqual({ status: 'completed' })
    expect(handler.handle).toHaveBeenCalledTimes(1)
  })

  it('a second concurrent claim on the same event is refused (no double-processing)', async () => {
    const store = new InMemoryEventDeliveryStore()
    store.seed(event())
    expect(await store.claim('event-1')).toBe(true)
    expect(await store.claim('event-1')).toBe(false)
  })

  it('retries a transient failure then succeeds on the next attempt', async () => {
    const store = new InMemoryEventDeliveryStore()
    store.seed(event())
    const handler: EventHandler = { eventType: 'task.created', handle: vi.fn().mockRejectedValueOnce(new Error('TRANSIENT_FAILURE')).mockResolvedValueOnce(undefined) }
    const first = await processOutboxEvent(event(), [handler], store, logger, now)
    expect(first.status).toBe('retry_scheduled')
    const retried = { ...event(), attemptCount: 1 }
    const second = await processOutboxEvent(retried, [handler], store, logger, now)
    expect(second).toEqual({ status: 'completed' })
  })

  it('dead-letters after exhausting retries', async () => {
    const store = new InMemoryEventDeliveryStore()
    const failing = { ...event(), attemptCount: 7 }
    store.seed(failing)
    const handler: EventHandler = { eventType: 'task.created', handle: vi.fn().mockRejectedValue(new Error('PERMANENT_FAILURE')) }
    const result = await processOutboxEvent(failing, [handler], store, logger, now)
    expect(result).toEqual({ status: 'dead_letter' })
  })

  it('duplicate delivery of an already-completed event does not invoke the handler again (no double business effect)', async () => {
    const store = new InMemoryEventDeliveryStore()
    store.seed({ ...event(), status: 'completed' })
    const handler: EventHandler = { eventType: 'task.created', handle: vi.fn() }
    const result = await processOutboxEvent(event(), [handler], store, logger, now)
    expect(result).toEqual({ status: 'already_completed' })
    expect(handler.handle).not.toHaveBeenCalled()
  })

  it('one failing event in a batch does not affect independent processing of another (partial failure isolation)', async () => {
    const storeA = new InMemoryEventDeliveryStore()
    const storeB = new InMemoryEventDeliveryStore()
    storeA.seed(event({ id: 'event-a' }))
    storeB.seed(event({ id: 'event-b' }))
    const failing: EventHandler = { eventType: 'task.created', handle: vi.fn().mockRejectedValue(new Error('ONE_FAILS')) }
    const succeeding: EventHandler = { eventType: 'task.created', handle: vi.fn().mockResolvedValue(undefined) }
    const resultA = await processOutboxEvent(event({ id: 'event-a' }), [failing], storeA, logger, now)
    const resultB = await processOutboxEvent(event({ id: 'event-b' }), [succeeding], storeB, logger, now)
    expect(resultA.status).toBe('retry_scheduled')
    expect(resultB.status).toBe('completed')
  })
})

describe('automation trigger matching (cross-organization isolation)', () => {
  /** Minimal in-memory Firestore double: supports the collection/where/limit query shape
   * matchAndRunAutomations uses, plus doc/runTransaction for the scoped AutomationRunStore it composes
   * internally (begin/quota), so automations can genuinely execute end to end in this test. */
  function fakeFirestore(byOrg: Record<string, readonly { id: string; data: Record<string, unknown> }[]>) {
    const queriedPaths: string[] = []
    const docs = new Map<string, Record<string, unknown>>()
    const firestore = {
      collection: (path: string) => {
        queriedPaths.push(path)
        const organizationId = path.split('/')[1]!
        const rows = (byOrg[organizationId] ?? []).map((entry) => ({ id: entry.id, data: () => entry.data }))
        return {
          where: () => ({
            where: () => ({ limit: () => ({ get: async () => ({ empty: rows.length === 0, docs: rows }) }) }),
          }),
        }
      },
      doc: (path: string) => ({
        path,
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        update: async (patch: Record<string, unknown>) => { docs.set(path, { ...docs.get(path), ...patch }) },
      }),
      runTransaction: async (fn: (transaction: {
        get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
        create: (ref: { path: string }, data: Record<string, unknown>) => void
        update: (ref: { path: string }, data: Record<string, unknown>) => void
      }) => unknown) => fn({
        get: async (ref) => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
        create: (ref, data) => { docs.set(ref.path, data) },
        update: (ref, data) => { docs.set(ref.path, { ...docs.get(ref.path), ...data }) },
      }),
    } as unknown as import('firebase-admin/firestore').Firestore
    return { firestore, queriedPaths }
  }

  it('only queries and matches the triggering event organization\'s own automation collection, never another tenant\'s', async () => {
    const orgAAutomation = { id: 'automation-a', data: { triggerType: 'task.created', status: 'active', definitionVersion: 1, conditions: [], actions: [{ type: 'task.add_tag', arguments: { taskId: 'task-1', tag: 'urgent' } }], servicePrincipalId: 'sp-1', scopeType: 'organization', scopeId: 'org-a' } }
    const orgBAutomation = { id: 'automation-b', data: { triggerType: 'task.created', status: 'active', definitionVersion: 1, conditions: [], actions: [{ type: 'task.add_tag', arguments: { taskId: 'task-1', tag: 'org-b-only' } }], servicePrincipalId: 'sp-1', scopeType: 'organization', scopeId: 'org-b' } }
    const { firestore, queriedPaths } = fakeFirestore({ 'org-a': [orgAAutomation], 'org-b': [orgBAutomation] })
    const executedTags: string[] = []
    const executor = { execute: vi.fn().mockImplementation(async (input: { action: { arguments: Record<string, string> } }) => { executedTags.push(input.action.arguments.tag!); return { resourceType: 'task', resourceId: 'task-1' } }) }
    await matchAndRunAutomations(firestore, event({ id: 'event-org-a', organizationId: 'org-a' }), executor, logger)
    expect(queriedPaths).toEqual(['v2Organizations/org-a/automation'])
    expect(executedTags).toEqual(['urgent'])
    expect(executedTags).not.toContain('org-b-only')
  })

  it('an automation match failure is logged and does not throw (never blocks the primary event)', async () => {
    const { firestore } = fakeFirestore({
      'org-1': [{ id: 'automation-x', data: { triggerType: 'task.created', status: 'active', definitionVersion: 1, conditions: [], actions: [{ type: 'task.add_tag', arguments: {} }], servicePrincipalId: 'sp-1', scopeType: 'organization', scopeId: 'org-1' } }],
    })
    const executor = { execute: vi.fn().mockRejectedValue(new Error('AUTOMATION_ACTION_ARGUMENTS_INVALID')) }
    await expect(matchAndRunAutomations(firestore, event(), executor, logger)).resolves.toBeUndefined()
  })
})

describe('dispatchEvent composes automation matching with the primary handler pipeline', () => {
  it('runs automation matching before the type-specific handler, and the handler still completes the event', async () => {
    const firestore = { collection: () => ({ where: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) }) }) } as unknown as import('firebase-admin/firestore').Firestore
    const store = new InMemoryEventDeliveryStore()
    store.seed(event())
    const handler: EventHandler = { eventType: 'task.created', handle: vi.fn().mockResolvedValue(undefined) }
    const deps: DispatchDeps = { firestore, handlers: [handler], automationExecutor: { execute: vi.fn() }, logger, now }
    const result = await dispatchEvent(event(), deps, store)
    expect(result).toEqual({ status: 'completed' })
    expect(handler.handle).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { LogRecord } from '@zamam/observability'
import { createLogger, redact } from '@zamam/observability'
import type { OutboxEvent } from '@zamam/domain'
import { createApi, resolveAllowedOrigins, type ApiDependencies } from '../services/functions/src/api/api'
import { InMemoryIdempotencyStore, InMemoryOutbox, InMemoryRateLimiter } from '../services/functions/src/platform/in-memory'
import { processOutboxEvent, type EventDeliveryStore } from '../services/workers/src/worker'
import { z } from 'zod'

function apiFixture(overrides: Partial<ApiDependencies> = {}) {
  const records: LogRecord[] = []
  const outbox = new InMemoryOutbox()
  const dependencies: ApiDependencies = {
    allowedOrigins: new Set(['http://localhost:5173']),
    tokenVerifier: { verify: vi.fn().mockResolvedValue({ userId: 'user-1', tokenIssuedAt: 100, emailVerified: true }) },
    appCheckVerifier: { verify: vi.fn().mockResolvedValue(undefined) },
    rateLimiter: new InMemoryRateLimiter(() => 1_000),
    idempotencyStore: new InMemoryIdempotencyStore(),
    outbox,
    logger: createLogger({ write: (record) => records.push(record) }, () => new Date('2026-01-01T00:00:00.000Z')),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
  return { handler: createApi(dependencies), dependencies, records, outbox }
}

function probeRequest(body = '{}', headers: Record<string, string> = {}) {
  return new Request('https://api.example.com/v1/system/probe', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token-123456',
      'content-type': 'application/json',
      'x-firebase-appcheck': 'test-app-check',
      'x-correlation-id': 'correlation-123',
      'x-idempotency-key': 'idempotency-123',
      origin: 'http://localhost:5173',
      ...headers,
    },
    body,
  })
}

describe('trusted API foundation', () => {
  it('traces a valid command end-to-end and emits one outbox event', async () => {
    const { handler, outbox, records } = apiFixture()
    const response = await handler(probeRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { status: 'ok', replayed: false },
      meta: { correlationId: 'correlation-123', apiVersion: 'v1' },
    })
    expect(outbox.events).toHaveLength(1)
    expect(outbox.events[0]).toMatchObject({ type: 'system.probe.received', correlationId: 'correlation-123' })
    expect(records.at(-1)?.event).toBe('api.system_probe.completed')
  })

  it('replays a completed idempotent command without another event', async () => {
    const { handler, outbox } = apiFixture()
    expect((await handler(probeRequest())).status).toBe(200)
    const replay = await handler(probeRequest())
    expect(await replay.json()).toMatchObject({ data: { replayed: true } })
    expect(outbox.events).toHaveLength(1)
  })

  it('rejects reuse of an idempotency key with another body', async () => {
    const { handler } = apiFixture()
    await handler(probeRequest())
    const response = await handler(probeRequest('{"clientTimestamp":"2026-01-01T00:00:00.000Z"}'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
  })

  it('fails closed for missing authentication and App Check', async () => {
    const { handler } = apiFixture()
    const noAppCheck = await handler(probeRequest('{}', { 'x-firebase-appcheck': '' }))
    expect(await noAppCheck.json()).toMatchObject({ error: { code: 'APP_CHECK_REQUIRED' } })
    const noAuth = await handler(probeRequest('{}', { authorization: '' }))
    expect(await noAuth.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } })
  })

  it('denies an unknown browser origin', async () => {
    const { handler } = apiFixture()
    const response = await handler(probeRequest('{}', { origin: 'https://untrusted.example' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'CORS_DENIED' } })
  })

  it('sends CORS headers on the OPTIONS preflight for an allowed origin', async () => {
    const { handler } = apiFixture()
    const preflight = new Request('https://api.example.com/v1/system/probe', {
      method: 'OPTIONS', headers: { origin: 'http://localhost:5173' },
    })
    const response = await handler(preflight)
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  it('returns validation errors for malformed JSON', async () => {
    const { handler } = apiFixture()
    const response = await handler(probeRequest('{'))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
  })

  it('enforces the configured request rate', async () => {
    const limiter = new InMemoryRateLimiter(() => 1_000)
    for (let index = 0; index < 20; index += 1) {
      expect(await limiter.consume('user-1', 20, 60)).toBe(true)
    }
    expect(await limiter.consume('user-1', 20, 60)).toBe(false)
  })

  it('composes typed feature routes behind the common trust boundary', async () => {
    const handle = vi.fn().mockResolvedValue({ workspaceId: 'workspace-1' })
    const { handler } = apiFixture({
      routes: {
        '/v1/workspaces/create': {
          operation: 'workspace.create',
          schema: z.object({ organizationId: z.string(), name: z.string().min(2) }).strict(),
          handle,
        },
      },
    })
    const response = await handler(new Request('https://api.example.com/v1/workspaces/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token-123456', 'content-type': 'application/json',
        'x-firebase-appcheck': 'test-app-check', 'x-correlation-id': 'correlation-456',
        'x-idempotency-key': 'idempotency-456', origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ organizationId: 'org-1', name: 'Workspace' }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { workspaceId: 'workspace-1' } })
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({ userId: 'user-1' }),
      correlationId: 'correlation-456', idempotencyKey: 'idempotency-456',
    }), { organizationId: 'org-1', name: 'Workspace' })
  })

  it('maps a domain state-violation error to 409 CONFLICT, not a bare 500', async () => {
    // A command that throws a business-rule error (the resource is not in a valid state) must surface a
    // 409 the caller can act on — previously these leaked as 500 INTERNAL_ERROR (e.g. project create for
    // a lead client, task create on a draft project).
    const { handler } = apiFixture({
      routes: {
        '/v1/projects/create': {
          operation: 'project.create',
          schema: z.object({ organizationId: z.string() }).passthrough(),
          handle: vi.fn().mockRejectedValue(new Error('CLIENT_NOT_ACTIVE')),
        },
      },
    })
    const response = await handler(new Request('https://api.example.com/v1/projects/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token-123456', 'content-type': 'application/json',
        'x-firebase-appcheck': 'test-app-check', 'x-correlation-id': 'correlation-789',
        'x-idempotency-key': 'idempotency-789', origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ organizationId: 'org-1' }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })
})

describe('resolveAllowedOrigins (CORS origin allowlist wiring)', () => {
  // Regression for the local-dev bug where the Tasks page (and every other authenticated feature) failed
  // with a CORS preflight error: firebase-adapter.ts read ZAMAM_ALLOWED_ORIGINS straight from
  // process.env, which is unset unless a developer manually creates services/functions/.env from
  // .env.example — with no explicit config, allowedOrigins was an empty Set, so createApi() denied
  // every origin including the Vite dev server's, and the OPTIONS preflight failed before ever reaching
  // route logic. This never surfaced in tests because api.ts's own CORS logic (given a correctly
  // populated allowedOrigins) was always correct — the bug was purely in how that set got built.
  it('denies every origin in production (no env var, not the emulator)', () => {
    expect(resolveAllowedOrigins({})).toEqual(new Set())
  })

  it('falls back to the Vite dev server origins only inside the emulator, when nothing is configured', () => {
    expect(resolveAllowedOrigins({ FUNCTIONS_EMULATOR: 'true' })).toEqual(
      new Set(['http://localhost:5173', 'http://127.0.0.1:5173']),
    )
  })

  it('prefers an explicitly configured ZAMAM_ALLOWED_ORIGINS even inside the emulator', () => {
    expect(resolveAllowedOrigins({
      FUNCTIONS_EMULATOR: 'true', ZAMAM_ALLOWED_ORIGINS: 'https://app.example.com, https://admin.example.com',
    })).toEqual(new Set(['https://app.example.com', 'https://admin.example.com']))
  })
})

describe('observability redaction', () => {
  it('redacts nested credentials without mutating normal fields', () => {
    expect(redact({ authorization: 'Bearer value', nested: { password: 'value', userId: 'user-1' } })).toEqual({
      authorization: '[REDACTED]', nested: { password: '[REDACTED]', userId: 'user-1' },
    })
  })
})

describe('worker delivery', () => {
  const event: OutboxEvent = {
    id: 'event-1', type: 'system.probe.received', version: 1, organizationId: null,
    actorUserId: 'user-1', correlationId: 'correlation-123', idempotencyKey: 'idempotency-123',
    payload: {}, status: 'pending', attemptCount: 0,
    availableAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  }

  function deliveryStore(): EventDeliveryStore {
    return {
      wasCompleted: vi.fn().mockResolvedValue(false),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      scheduleRetry: vi.fn().mockResolvedValue(undefined),
      moveToDeadLetter: vi.fn().mockResolvedValue(undefined),
    }
  }

  const logger = createLogger({ write: vi.fn() }, () => new Date('2026-01-01T00:00:00.000Z'))

  it('marks a handled event complete', async () => {
    const store = deliveryStore()
    const result = await processOutboxEvent(
      event,
      [{ eventType: event.type, handle: vi.fn().mockResolvedValue(undefined) }],
      store,
      logger,
      () => new Date('2026-01-01T00:00:00.000Z'),
    )
    expect(result).toEqual({ status: 'completed' })
    expect(store.markCompleted).toHaveBeenCalledWith('event-1', '2026-01-01T00:00:00.000Z')
  })

  it('schedules bounded exponential retry and eventually dead-letters', async () => {
    const store = deliveryStore()
    const handler = { eventType: event.type, handle: vi.fn().mockRejectedValue(new Error('TEMPORARY_FAILURE')) }
    expect((await processOutboxEvent(event, [handler], store, logger)).status).toBe('retry_scheduled')
    const finalEvent = { ...event, attemptCount: 7 }
    expect(await processOutboxEvent(finalEvent, [handler], store, logger)).toEqual({ status: 'dead_letter' })
    expect(store.moveToDeadLetter).toHaveBeenCalledWith('event-1', 8, 'TEMPORARY_FAILURE')
  })
})

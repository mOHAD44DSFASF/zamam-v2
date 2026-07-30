import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '@zamam/observability'
import { createApi } from '../services/functions/src/api/api'
import { createFeatureRoutes } from '../services/functions/src/api/feature-routes'
import { ComposedFeatureCommandDispatcher } from '../services/functions/src/api/dispatcher'
import { InMemoryIdempotencyStore, InMemoryOutbox, InMemoryRateLimiter } from '../services/functions/src/platform/in-memory'
import type { IdentityResolver } from '../services/functions/src/platform/identity'
import type { HandlerRegistry } from '../services/functions/src/api/registry'

function fakeIdentity(overrides: Partial<Parameters<IdentityResolver['resolve']>[0]> = {}): IdentityResolver {
  return {
    async resolve(principal, organizationId) {
      return {
        userId: principal.userId, authenticated: true, tokenFresh: true,
        accountStatus: 'active', employmentStatus: 'active', organizationId,
        membershipStatus: 'active', principalType: 'member', clientAccountIds: [],
        stepUpSatisfied: true, mfaSatisfied: true, ...overrides,
      }
    },
  }
}

function apiHarness(registry: HandlerRegistry, identity: IdentityResolver = fakeIdentity()) {
  const dispatcher = new ComposedFeatureCommandDispatcher(registry, identity)
  return createApi({
    allowedOrigins: new Set(),
    logger: createLogger({ write: vi.fn() }),
    idempotencyStore: new InMemoryIdempotencyStore(),
    outbox: new InMemoryOutbox(),
    rateLimiter: new InMemoryRateLimiter(),
    tokenVerifier: { verify: vi.fn().mockResolvedValue({ userId: 'user-1', tokenIssuedAt: Math.floor(Date.now() / 1000), emailVerified: true }) },
    appCheckVerifier: { verify: vi.fn() },
    routes: createFeatureRoutes(dispatcher),
  })
}

function request(path: string, body: unknown, idempotencyKey = 'request-key-0000001') {
  return new Request(`https://local${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-value-long', 'x-firebase-appcheck': 'test',
      'x-idempotency-key': idempotencyKey, 'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('ComposedFeatureCommandDispatcher', () => {
  it('fails closed on a command with no registered handler', async () => {
    const dispatcher = new ComposedFeatureCommandDispatcher({}, fakeIdentity())
    await expect(dispatcher.execute('/v1/tasks/query', {
      principal: { userId: 'user-1', tokenIssuedAt: 0, emailVerified: true },
      correlationId: 'correlation-1', idempotencyKey: 'key-1', request: new Request('https://local/v1/tasks/query'),
    }, { organizationId: 'org-1' })).rejects.toThrow('UNKNOWN_COMMAND_NOT_CONFIGURED')
  })

  it('resolves the caller identity and passes a fully-formed command context to the handler', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const dispatcher = new ComposedFeatureCommandDispatcher({ '/v1/tasks/query': handler }, fakeIdentity({ principalType: 'member' }))
    await dispatcher.execute('/v1/tasks/query', {
      principal: { userId: 'user-1', tokenIssuedAt: 0, emailVerified: true },
      correlationId: 'correlation-1', idempotencyKey: 'key-1', request: new Request('https://local/v1/tasks/query'),
    }, { organizationId: 'org-42', scope: { type: 'organization' } })
    expect(handler).toHaveBeenCalledTimes(1)
    const [context, input] = handler.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(context).toMatchObject({ organizationId: 'org-42', correlationId: 'correlation-1', idempotencyKey: 'key-1' })
    expect(context.principal).toMatchObject({ userId: 'user-1', organizationId: 'org-42', principalType: 'member' })
    expect(typeof context.fingerprint).toBe('string')
    expect(input).toEqual({ organizationId: 'org-42', scope: { type: 'organization' } })
  })

  it('does not resolve identity for public routes and uses the unauthenticated stub principal', async () => {
    const identity = fakeIdentity()
    const resolveSpy = vi.spyOn(identity, 'resolve')
    const handler = vi.fn().mockResolvedValue({ accepted: true })
    const dispatcher = new ComposedFeatureCommandDispatcher({ '/v1/auth/password-reset': handler }, identity)
    await dispatcher.execute('/v1/auth/password-reset', {
      principal: { userId: 'public-auth', tokenIssuedAt: 0, emailVerified: false },
      correlationId: 'correlation-1', idempotencyKey: 'key-1', request: new Request('https://local/v1/auth/password-reset'),
    }, { email: 'user@example.test' })
    expect(resolveSpy).not.toHaveBeenCalled()
    const [context] = handler.mock.calls[0] as [Record<string, unknown>]
    expect(context.principal).toMatchObject({ userId: 'public-auth', authenticated: false })
  })

  it('returns 200 for an authorized, successfully handled command', async () => {
    const api = apiHarness({ '/v1/tasks/query': vi.fn().mockResolvedValue({ items: [] }) })
    const response = await api(request('/v1/tasks/query', { organizationId: 'org-1' }))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ items: [] })
  })

  it('maps an authorization denial from a handler to 403', async () => {
    const api = apiHarness({ '/v1/tasks/query': vi.fn().mockRejectedValue(new Error('AUTHORIZATION_DENIED')) })
    const response = await api(request('/v1/tasks/query', { organizationId: 'org-1' }))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('AUTHORIZATION_DENIED')
  })

  it('maps a cross-organization denial from a handler to 403', async () => {
    const api = apiHarness({ '/v1/tasks/query': vi.fn().mockRejectedValue(new Error('CROSS_ORGANIZATION_DENIED')) })
    const response = await api(request('/v1/tasks/query', { organizationId: 'org-2' }))
    expect(response.status).toBe(403)
  })

  it('returns a stable typed response for a disabled feature rather than a bare 503-uncomposed error', async () => {
    const api = apiHarness({ '/v1/ai/request': vi.fn().mockRejectedValue(new Error('AI_DISABLED')) })
    const response = await api(request('/v1/ai/request', { organizationId: 'org-1', id: 'req-1', purpose: 'summarize', content: 'x', classification: 'internal' }))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('FEATURE_DISABLED')
  })

  it('replays an idempotent command instead of invoking the handler twice', async () => {
    const handler = vi.fn().mockResolvedValue({ taskId: 'task-1', version: 1 })
    const api = apiHarness({ '/v1/tasks/create': handler })
    const body = { organizationId: 'org-1', id: 'task-1', projectId: 'project-1', title: 'Task' }
    const first = await api(request('/v1/tasks/create', body, 'idempotency-key-001'))
    const second = await api(request('/v1/tasks/create', body, 'idempotency-key-001'))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

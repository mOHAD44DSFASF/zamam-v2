import { randomUUID } from 'node:crypto'
import { API_VERSION, type ApiEnvelope, type ApiErrorCode, type AuthenticatedPrincipal, type SystemProbeResult } from '@zamam/contracts'
import type { OutboxEvent } from '@zamam/domain'
import type { createLogger } from '@zamam/observability'
import { z } from 'zod'
import { executeIdempotently, fingerprint, IdempotencyConflictError } from '../platform/idempotency.js'
import type { AppCheckVerifier, IdempotencyStore, OutboxPublisher, RateLimiter, TokenVerifier } from '../platform/ports.js'

const probeSchema = z.object({ clientTimestamp: z.string().datetime().optional() }).strict()
const correlationPattern = /^[A-Za-z0-9_-]{8,64}$/
const idempotencyPattern = /^[A-Za-z0-9_-]{8,128}$/

class ApiError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string) { super(message) }
}

export interface ApiDependencies {
  tokenVerifier: TokenVerifier
  appCheckVerifier: AppCheckVerifier
  rateLimiter: RateLimiter
  idempotencyStore: IdempotencyStore
  outbox: OutboxPublisher
  logger: ReturnType<typeof createLogger>
  allowedOrigins: ReadonlySet<string>
  now?: () => Date
}

function json<T>(status: number, payload: ApiEnvelope<T>, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

function corsHeaders(request: Request, allowedOrigins: ReadonlySet<string>) {
  const origin = request.headers.get('origin')
  if (!origin) return {}
  if (!allowedOrigins.has(origin)) throw new ApiError(403, 'CORS_DENIED', 'Origin is not allowed')
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck, x-correlation-id, x-idempotency-key',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

function bearer(request: Request) {
  const value = request.headers.get('authorization')
  if (!value?.startsWith('Bearer ') || value.length < 16) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
  return value.slice(7)
}

function correlationId(request: Request) {
  const value = request.headers.get('x-correlation-id')
  return value && correlationPattern.test(value) ? value : randomUUID()
}

export function createApi(dependencies: ApiDependencies) {
  const now = dependencies.now ?? (() => new Date())

  return async (request: Request): Promise<Response> => {
    const correlation = correlationId(request)
    let cors: HeadersInit = {}
    try {
      cors = corsHeaders(request, dependencies.allowedOrigins)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      if (new URL(request.url).pathname !== '/v1/system/probe' || request.method !== 'POST') {
        throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found')
      }

      const contentLength = Number(request.headers.get('content-length') ?? 0)
      if (contentLength > 16_384) throw new ApiError(400, 'INVALID_REQUEST', 'Request is too large')
      const rawBody = await request.text()
      if (rawBody.length > 16_384) throw new ApiError(400, 'INVALID_REQUEST', 'Request is too large')
      let body: unknown
      try { body = JSON.parse(rawBody || '{}') } catch { throw new ApiError(400, 'INVALID_REQUEST', 'Request validation failed') }
      const parsed = probeSchema.safeParse(body)
      if (!parsed.success) throw new ApiError(400, 'INVALID_REQUEST', 'Request validation failed')

      const appCheckToken = request.headers.get('x-firebase-appcheck')
      if (!appCheckToken) throw new ApiError(401, 'APP_CHECK_REQUIRED', 'App Check is required')
      try { await dependencies.appCheckVerifier.verify(appCheckToken) } catch {
        throw new ApiError(401, 'APP_CHECK_REQUIRED', 'App Check is required')
      }
      let principal: AuthenticatedPrincipal
      try { principal = await dependencies.tokenVerifier.verify(bearer(request)) } catch {
        throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
      }

      if (!await dependencies.rateLimiter.consume(`system.probe:${principal.userId}`, 20, 60)) {
        throw new ApiError(429, 'RATE_LIMITED', 'Too many requests')
      }
      const idempotencyKey = request.headers.get('x-idempotency-key') ?? ''
      if (!idempotencyPattern.test(idempotencyKey)) throw new ApiError(400, 'INVALID_REQUEST', 'A valid idempotency key is required')

      const execution = await executeIdempotently(dependencies.idempotencyStore, {
        key: idempotencyKey,
        operation: 'system.probe',
        fingerprint: fingerprint(rawBody),
        actorUserId: principal.userId,
      }, async () => {
        const processedAt = now().toISOString()
        const event: OutboxEvent = {
          id: randomUUID(), type: 'system.probe.received', version: 1, organizationId: null,
          actorUserId: principal.userId, correlationId: correlation, idempotencyKey,
          payload: { processedAt }, status: 'pending', attemptCount: 0,
          availableAt: processedAt, createdAt: processedAt,
        }
        await dependencies.outbox.publish(event)
        return { status: 'ok', processedAt, replayed: false }
      })

      const result: SystemProbeResult = { ...execution.result, replayed: execution.replayed }
      dependencies.logger.info('api.system_probe.completed', correlation, { actorUserId: principal.userId, replayed: execution.replayed })
      return json(200, { data: result, meta: { correlationId: correlation, apiVersion: API_VERSION } }, cors)
    } catch (error) {
      const apiError = error instanceof IdempotencyConflictError
        ? new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key conflicts with another request')
        : error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed')
      dependencies.logger.warn('api.request.rejected', correlation, { code: apiError.code, error })
      return json(apiError.status, {
        error: { code: apiError.code, message: apiError.message },
        meta: { correlationId: correlation, apiVersion: API_VERSION },
      }, cors)
    }
  }
}

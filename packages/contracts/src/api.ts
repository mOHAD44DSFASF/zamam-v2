export const API_VERSION = 'v1' as const

export interface ApiMeta {
  correlationId: string
  apiVersion: typeof API_VERSION
}

export interface ApiSuccess<T> {
  data: T
  meta: ApiMeta
}

export interface ApiFailure {
  error: {
    code: ApiErrorCode
    message: string
    details?: Readonly<Record<string, string>>
  }
  meta: ApiMeta
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'APP_CHECK_REQUIRED'
  | 'CORS_DENIED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'FEATURE_DISABLED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export interface SystemProbeCommand {
  clientTimestamp?: string
}

export interface SystemProbeResult {
  status: 'ok'
  processedAt: string
  replayed: boolean
}

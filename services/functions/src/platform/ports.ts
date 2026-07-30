import type { AuthenticatedPrincipal, SystemProbeResult } from '@zamam/contracts'
import type { OutboxEvent } from '@zamam/domain'

export interface TokenVerifier {
  verify(bearerToken: string): Promise<AuthenticatedPrincipal>
}

export interface AppCheckVerifier {
  verify(appCheckToken: string): Promise<void>
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>
}

export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>
}

export type SecretName =
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'OPENAI_API_KEY'
  | 'EMAIL_PROVIDER_API_KEY'
  | 'CLIENT_PII_ENCRYPTION_KEY'
  | 'CLIENT_PII_HASH_KEY'
  | 'CLIENT_PII_KEY_VERSION'

export interface SecretProvider {
  get(name: SecretName): Promise<string>
}

export interface IdempotencyEntry {
  operation: string
  fingerprint: string
  actorUserId: string
  result?: SystemProbeResult
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyEntry | null>
  create(key: string, entry: IdempotencyEntry): Promise<boolean>
  complete(key: string, result: SystemProbeResult): Promise<void>
  remove(key: string): Promise<void>
}

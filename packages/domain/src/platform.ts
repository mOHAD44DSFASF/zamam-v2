export type IdempotencyStatus = 'processing' | 'completed' | 'failed'

export interface IdempotencyRecord {
  key: string
  operation: string
  fingerprint: string
  status: IdempotencyStatus
  actorUserId: string
  organizationId: string | null
  responseJson?: string
  createdAt: string
  expiresAt: string
}

export type OutboxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter'

export interface OutboxEvent<TPayload = unknown> {
  id: string
  type: string
  version: number
  organizationId: string | null
  actorUserId: string | null
  correlationId: string
  idempotencyKey: string
  payload: TPayload
  status: OutboxStatus
  attemptCount: number
  availableAt: string
  createdAt: string
  processedAt?: string
  lastErrorCode?: string
}

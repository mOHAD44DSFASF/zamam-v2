import { createHash } from 'node:crypto'
import type { IdempotencyStore } from './ports.js'

export class IdempotencyConflictError extends Error {
  constructor() { super('IDEMPOTENCY_CONFLICT') }
}

export function fingerprint(payload: string) {
  return createHash('sha256').update(payload).digest('hex')
}

export async function executeIdempotently<TResult>(
  store: IdempotencyStore,
  input: { key: string; operation: string; fingerprint: string; actorUserId: string },
  operation: () => Promise<TResult>,
): Promise<{ result: TResult; replayed: boolean }> {
  const existing = await store.get(input.key)
  if (existing) {
    if (existing.operation !== input.operation || existing.fingerprint !== input.fingerprint || existing.actorUserId !== input.actorUserId) {
      throw new IdempotencyConflictError()
    }
    if (!existing.result) throw new IdempotencyConflictError()
    return { result: existing.result as TResult, replayed: true }
  }

  const created = await store.create(input.key, input)
  if (!created) throw new IdempotencyConflictError()
  try {
    const result = await operation()
    await store.complete(input.key, result)
    return { result, replayed: false }
  } catch (error) {
    await store.remove(input.key)
    throw error
  }
}

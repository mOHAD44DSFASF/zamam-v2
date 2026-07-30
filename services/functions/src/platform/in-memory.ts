import type { OutboxEvent } from '@zamam/domain'
import type { IdempotencyEntry, IdempotencyStore, OutboxPublisher, RateLimiter } from './ports.js'

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>()

  async get(key: string) { return this.entries.get(key) ?? null }
  async create(key: string, entry: IdempotencyEntry) {
    if (this.entries.has(key)) return false
    this.entries.set(key, entry)
    return true
  }
  async complete(key: string, result: IdempotencyEntry['result']) {
    const entry = this.entries.get(key)
    if (!entry || !result) throw new Error('IDEMPOTENCY_ENTRY_MISSING')
    this.entries.set(key, { ...entry, result })
  }
  async remove(key: string) { this.entries.delete(key) }
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetsAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, limit: number, windowSeconds: number) {
    const current = this.windows.get(key)
    const now = this.now()
    if (!current || current.resetsAt <= now) {
      this.windows.set(key, { count: 1, resetsAt: now + windowSeconds * 1_000 })
      return true
    }
    if (current.count >= limit) return false
    current.count += 1
    return true
  }
}

export class InMemoryOutbox implements OutboxPublisher {
  readonly events: OutboxEvent[] = []
  async publish(event: OutboxEvent) { this.events.push(event) }
}

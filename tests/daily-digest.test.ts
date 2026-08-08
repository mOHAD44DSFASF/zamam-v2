import { describe, expect, it } from 'vitest'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import { DailyDigestService, type DigestContentPort, type DigestRecipient, type DigestRecipientPort } from '../services/workers/src/daily-digest'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    const transaction: AtomicTransaction = {
      get: async (path) => working.get(path) ?? null,
      create: (path, data) => { if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, { ...data }) },
      update: (path, data) => { const current = working.get(path); if (!current) throw new Error('NOT_FOUND'); working.set(path, { ...current, ...data }) },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}

function recipientsPort(rows: readonly DigestRecipient[]): DigestRecipientPort {
  return { listActiveRecipients: async () => rows }
}
const contentPort: DigestContentPort = { countForScope: async () => ({ dueToday: 3, stalledOrOverdue: 1 }) }

describe('DailyDigestService', () => {
  it('sends once the 08:00-local slot has passed for a recipient, and computes real counts', async () => {
    const store = new MemoryStore()
    // 09:00 UTC on a Cairo-timezone (+2/+3) user is well past their 08:00 local slot.
    const service = new DailyDigestService(store, recipientsPort([
      { userId: 'user-1', timezone: 'Africa/Cairo', scope: { type: 'employee', userId: 'user-1' } },
    ]), contentPort, { now: () => '2026-08-08T09:00:00.000Z' })
    const result = await service.scan('org-1')
    expect(result).toMatchObject({ scanned: 1, due: 1, sent: 1 })
    const outbox = [...store.records.entries()].find(([path]) => path.includes('_outboxEvents'))?.[1]
    expect(outbox).toMatchObject({
      type: 'digest.daily',
      payload: { recipientUserIds: ['user-1'], scopeType: 'employee', dueToday: 3, stalledOrOverdue: 1 },
    })
  })

  it('does not send before the recipient\'s local 08:00 slot arrives', async () => {
    const store = new MemoryStore()
    // 04:00 UTC is 06:00-07:00 in Cairo (+2/+3) — before the 08:00 local slot.
    const service = new DailyDigestService(store, recipientsPort([
      { userId: 'user-2', timezone: 'Africa/Cairo', scope: { type: 'employee', userId: 'user-2' } },
    ]), contentPort, { now: () => '2026-08-08T04:00:00.000Z' })
    const result = await service.scan('org-1')
    expect(result).toMatchObject({ due: 0, sent: 0 })
    expect(store.records.size).toBe(0)
  })

  it('sends at most once per calendar day per recipient, even across multiple scans after the slot', async () => {
    const store = new MemoryStore()
    const now = { now: () => '2026-08-08T09:00:00.000Z' }
    const service1 = new DailyDigestService(store, recipientsPort([
      { userId: 'user-3', timezone: 'Africa/Cairo', scope: { type: 'organization' } },
    ]), contentPort, now)
    expect((await service1.scan('org-1')).sent).toBe(1)
    const service2 = new DailyDigestService(store, recipientsPort([
      { userId: 'user-3', timezone: 'Africa/Cairo', scope: { type: 'organization' } },
    ]), contentPort, now)
    expect((await service2.scan('org-1')).sent).toBe(0)
    const outboxCount = [...store.records.keys()].filter((path) => path.includes('_outboxEvents')).length
    expect(outboxCount).toBe(1)
  })

  it('sends again the following calendar day for the same recipient', async () => {
    const store = new MemoryStore()
    const day1 = new DailyDigestService(store, recipientsPort([
      { userId: 'user-4', timezone: 'UTC', scope: { type: 'department', departmentId: 'dept-1' } },
    ]), contentPort, { now: () => '2026-08-08T09:00:00.000Z' })
    expect((await day1.scan('org-1')).sent).toBe(1)
    const day2 = new DailyDigestService(store, recipientsPort([
      { userId: 'user-4', timezone: 'UTC', scope: { type: 'department', departmentId: 'dept-1' } },
    ]), contentPort, { now: () => '2026-08-09T09:00:00.000Z' })
    expect((await day2.scan('org-1')).sent).toBe(1)
    const outboxCount = [...store.records.keys()].filter((path) => path.includes('_outboxEvents')).length
    expect(outboxCount).toBe(2)
  })

  it('scopes content correctly per recipient role (organization vs department vs employee)', async () => {
    const store = new MemoryStore()
    const seen: string[] = []
    const trackingContent: DigestContentPort = {
      countForScope: async (_org, scope) => { seen.push(scope.type); return { dueToday: 0, stalledOrOverdue: 0 } },
    }
    const service = new DailyDigestService(store, recipientsPort([
      { userId: 'owner-1', timezone: 'UTC', scope: { type: 'organization' } },
      { userId: 'lead-1', timezone: 'UTC', scope: { type: 'department', departmentId: 'dept-1' } },
      { userId: 'emp-1', timezone: 'UTC', scope: { type: 'employee', userId: 'emp-1' } },
    ]), trackingContent, { now: () => '2026-08-08T09:00:00.000Z' })
    await service.scan('org-1')
    expect(seen.sort()).toEqual(['department', 'employee', 'organization'])
  })
})

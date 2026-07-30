import { describe, expect, it, vi } from 'vitest'
import {
  LocalEmailProvider, NotificationDeliveryJob, ResendEmailProvider,
  type NotificationDeliveryStore, type NotificationDeliveryWorkItem,
} from '../services/workers/src'

class DeliveryStore implements NotificationDeliveryStore {
  delivered: string[][] = []
  retries: Array<{ id: string; attempt: number; code: string }> = []
  deadLetters: Array<{ id: string; attempt: number; code: string }> = []
  async claim() { return true }
  async markDelivered(ids: readonly string[]) { this.delivered.push([...ids]) }
  async scheduleRetry(id: string, attempt: number, _at: string, code: string) {
    this.retries.push({ id, attempt, code })
  }
  async moveToDeadLetter(id: string, attempt: number, code: string) {
    this.deadLetters.push({ id, attempt, code })
  }
}
const item = (id: string, overrides: Partial<NotificationDeliveryWorkItem> = {}): NotificationDeliveryWorkItem => ({
  id, organizationId: 'org-1', notificationId: `notification-${id}`,
  recipientUserId: 'user-1', locale: 'ar', digest: 'daily',
  critical: false, attemptCount: 0, version: 1, ...overrides,
})
const directory = {
  resolve: async () => ({ active: true, email: 'member@example.invalid', locale: 'ar' as const }),
}

describe('notification email delivery', () => {
  it('groups digest items, uses a deterministic idempotency key, and sends no work details', async () => {
    const store = new DeliveryStore()
    const provider = new LocalEmailProvider()
    const job = new NotificationDeliveryJob(
      store, directory, provider, 'https://app.example.invalid',
      () => new Date('2026-07-30T10:00:00.000Z'),
    )
    expect(await job.run([item('delivery-1'), item('delivery-2')]))
      .toEqual({ delivered: 2, retried: 0, deadLettered: 0 })
    expect(provider.messages).toHaveLength(1)
    expect(provider.messages[0]?.subject).toContain('2')
    expect(provider.messages[0]?.actionUrl).toBe('https://app.example.invalid/notifications')
    expect(provider.messages[0]?.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(provider.messages[0])).not.toContain('task')
    expect(JSON.stringify(provider.messages[0])).not.toContain('comment')
    expect(store.delivered).toEqual([['delivery-1', 'delivery-2']])
  })

  it('does not group immediate alerts and localizes English safely', async () => {
    const store = new DeliveryStore()
    const provider = new LocalEmailProvider()
    const job = new NotificationDeliveryJob(store, {
      resolve: async () => ({ active: true, email: 'member@example.invalid', locale: 'en' as const }),
    }, provider, 'https://app.example.invalid')
    await job.run([
      item('delivery-1', { digest: 'immediate', critical: true }),
      item('delivery-2', { digest: 'immediate', critical: true }),
    ])
    expect(provider.messages).toHaveLength(2)
    expect(provider.messages[0]?.subject).toBe('Important ZAMAM alert')
  })

  it('retries a missing provider and dead-letters at the configured attempt limit', async () => {
    const store = new DeliveryStore()
    const unavailable = { provider: 'none', configured: false, send: vi.fn() }
    const job = new NotificationDeliveryJob(store, directory, unavailable, 'https://app.example.invalid')
    await job.run([item('retry-1')])
    await job.run([item('dead-1', { attemptCount: 7 })])
    expect(store.retries[0]).toMatchObject({ id: 'retry-1', attempt: 1, code: 'EMAIL_PROVIDER_NOT_CONFIGURED' })
    expect(store.deadLetters[0]).toMatchObject({ id: 'dead-1', attempt: 8, code: 'EMAIL_PROVIDER_NOT_CONFIGURED' })
    expect(unavailable.send).not.toHaveBeenCalled()
  })

  it('uses the provider idempotency header and classifies 429 as retryable without network', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429 }))
    const provider = new ResendEmailProvider('test-key', 'sender@example.invalid', fetcher)
    await expect(provider.send({
      to: 'member@example.invalid', subject: 'Safe', text: 'Safe text',
      actionUrl: 'https://app.example.invalid/notifications', idempotencyKey: 'key-1',
    })).rejects.toThrow('EMAIL_PROVIDER_RETRYABLE')
    expect(fetcher).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      headers: expect.objectContaining({ 'idempotency-key': 'key-1' }),
    }))
  })
})

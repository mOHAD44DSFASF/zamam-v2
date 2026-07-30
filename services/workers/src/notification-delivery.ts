import type { OutboxEvent } from '@zamam/domain'
import type { EventHandler } from './worker.js'

export interface NotificationProjectionPort {
  project(event: OutboxEvent): Promise<unknown>
}
export class NotificationProjectionHandler implements EventHandler {
  constructor(readonly eventType: string, private readonly projector: NotificationProjectionPort) {}
  async handle(event: OutboxEvent) { await this.projector.project(event) }
}

export interface NotificationDeliveryWorkItem {
  id: string
  organizationId: string
  notificationId: string
  recipientUserId: string
  locale: 'ar' | 'en'
  digest: 'immediate' | 'daily' | 'weekly'
  critical: boolean
  attemptCount: number
  version: number
}
export interface NotificationDeliveryStore {
  claim(id: string, expectedVersion: number, claimedAt: string): Promise<boolean>
  markDelivered(ids: readonly string[], providerMessageId: string, deliveredAt: string): Promise<void>
  scheduleRetry(id: string, attemptCount: number, availableAt: string, errorCode: string): Promise<void>
  moveToDeadLetter(id: string, attemptCount: number, errorCode: string): Promise<void>
}
export interface NotificationRecipientDirectory {
  resolve(organizationId: string, userId: string): Promise<{
    active: boolean
    email: string | null
    locale: 'ar' | 'en'
  }>
}
export interface EmailProvider {
  readonly provider: string
  readonly configured: boolean
  send(message: {
    to: string
    subject: string
    text: string
    actionUrl: string
    idempotencyKey: string
  }): Promise<{ messageId: string }>
}

const errorCode = (error: unknown) =>
  error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)
    ? error.message
    : 'EMAIL_DELIVERY_FAILED'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const groupKey = (item: NotificationDeliveryWorkItem) =>
  item.digest === 'immediate' ? item.id : `${item.organizationId}:${item.recipientUserId}:${item.digest}`
const safeContent = (locale: 'ar' | 'en', count: number, critical: boolean) => {
  if (locale === 'ar') return {
    subject: critical ? 'تنبيه مهم من زمام' : count > 1 ? `ملخص زمام: ${count} تحديثات` : 'تحديث جديد في زمام',
    text: 'سجل الدخول إلى زمام لعرض التفاصيل بأمان. لا يحتوي هذا البريد على بيانات العمل.',
  }
  return {
    subject: critical ? 'Important ZAMAM alert' : count > 1 ? `ZAMAM digest: ${count} updates` : 'New ZAMAM update',
    text: 'Sign in to ZAMAM to view details securely. This email contains no work data.',
  }
}
const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0')).join('')
}

export class NotificationDeliveryJob {
  constructor(
    private readonly store: NotificationDeliveryStore,
    private readonly directory: NotificationRecipientDirectory,
    private readonly provider: EmailProvider,
    private readonly appBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly maxAttempts = 8,
  ) {
    const url = new URL(appBaseUrl)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('NOTIFICATION_APP_URL_INSECURE')
    }
  }

  async run(items: readonly NotificationDeliveryWorkItem[]) {
    if (items.length > 50) throw new Error('NOTIFICATION_BATCH_TOO_LARGE')
    const groups = new Map<string, NotificationDeliveryWorkItem[]>()
    for (const item of items) groups.set(groupKey(item), [...(groups.get(groupKey(item)) ?? []), item])
    let delivered = 0
    let retried = 0
    let deadLettered = 0
    for (const group of groups.values()) {
      const claimed: NotificationDeliveryWorkItem[] = []
      for (const item of group) {
        if (await this.store.claim(item.id, item.version, this.now().toISOString())) claimed.push(item)
      }
      if (!claimed.length) continue
      const first = claimed[0]
      if (!first) continue
      try {
        if (!this.provider.configured) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED')
        const recipient = await this.directory.resolve(first.organizationId, first.recipientUserId)
        if (!recipient.active || !recipient.email || !emailPattern.test(recipient.email)) {
          throw new Error('EMAIL_RECIPIENT_UNAVAILABLE')
        }
        const content = safeContent(
          recipient.locale, claimed.length, claimed.some(({ critical }) => critical),
        )
        const idempotencyKey = await sha256(
          claimed.map(({ id }) => id).sort().join(':'),
        )
        const result = await this.provider.send({
          to: recipient.email, ...content,
          actionUrl: `${this.appBaseUrl.replace(/\/$/, '')}/notifications`,
          idempotencyKey,
        })
        await this.store.markDelivered(
          claimed.map(({ id }) => id), result.messageId, this.now().toISOString(),
        )
        delivered += claimed.length
      } catch (error) {
        const code = errorCode(error)
        for (const item of claimed) {
          const attempt = item.attemptCount + 1
          if (attempt >= this.maxAttempts) {
            await this.store.moveToDeadLetter(item.id, attempt, code)
            deadLettered += 1
          } else {
            const availableAt = new Date(
              this.now().getTime() + Math.min(3_600, 2 ** attempt * 10) * 1_000,
            ).toISOString()
            await this.store.scheduleRetry(item.id, attempt, availableAt, code)
            retried += 1
          }
        }
      }
    }
    return { delivered, retried, deadLettered }
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly provider = 'resend'
  readonly configured: boolean
  constructor(
    private readonly apiKey: string | undefined,
    private readonly from: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.configured = Boolean(apiKey && emailPattern.test(from))
  }
  async send(message: {
    to: string; subject: string; text: string; actionUrl: string; idempotencyKey: string
  }) {
    if (!this.configured || !this.apiKey) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED')
    const response = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from, to: [message.to], subject: message.subject,
        text: `${message.text}\n\n${message.actionUrl}`,
      }),
    })
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) throw new Error('EMAIL_PROVIDER_RETRYABLE')
      throw new Error('EMAIL_PROVIDER_REJECTED')
    }
    const body = await response.json() as { id?: unknown }
    if (typeof body.id !== 'string') throw new Error('EMAIL_PROVIDER_RESPONSE_INVALID')
    return { messageId: body.id }
  }
}

export class LocalEmailProvider implements EmailProvider {
  readonly provider = 'local'
  readonly configured = true
  readonly messages: Array<{
    to: string; subject: string; text: string; actionUrl: string; idempotencyKey: string
  }> = []
  async send(message: {
    to: string; subject: string; text: string; actionUrl: string; idempotencyKey: string
  }) {
    this.messages.push({ ...message })
    return { messageId: `local-${this.messages.length}` }
  }
}

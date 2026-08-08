import { randomUUID } from 'node:crypto'
import { SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore } from '@zamam/firestore'

/**
 * Part 3B — daily digest. Delivery time is a sensible hardcoded default (08:00 organization-member-local,
 * per-user via their own profile timezone — not a single organization-wide instant), checked with the same
 * Intl.DateTimeFormat local-time-of-day technique packages/domain/src/notifications.ts's localTime()
 * already uses for quiet-hours — not a new time-computation approach. (An earlier version of this reused
 * nextRecurrenceOccurrence()'s lookback math instead; that turned out to have an off-by-a-day edge case
 * right around a recipient's own local midnight, so this is the simpler, directly-verified approach.)
 * In-app + push only (Part 2's existing pipeline, via one more ordinary outbox event type); no WhatsApp —
 * reserved for the higher-urgency escalation case per the product brief, to avoid notification fatigue.
 *
 * Same "no cron wired up" caveat as stalled-task-escalation.ts: scan() is designed to be called
 * periodically (hourly is reasonable — it only sends once per user per calendar day, tracked via a
 * deterministic-create marker on daily_digest_delivery, so a finer or coarser cadence both work correctly,
 * just with more or less delay after the 8am mark passes) by whatever external scheduler eventually gets
 * provisioned; exposed here as one more /internal/scheduled/* worker endpoint.
 */

export type DigestScope = { type: 'organization' } | { type: 'department'; departmentId: string } | { type: 'employee'; userId: string }
export interface DigestRecipient { userId: string; timezone: string; scope: DigestScope }
export interface DigestCounts { dueToday: number; stalledOrOverdue: number }

export interface DigestRecipientPort {
  listActiveRecipients(organizationId: string, limit: number): Promise<readonly DigestRecipient[]>
}
export interface DigestContentPort {
  countForScope(organizationId: string, scope: DigestScope, now: string): Promise<DigestCounts>
}
export interface DigestClock { now(): string }

export interface DailyDigestResult { scanned: number; due: number; sent: number }

const DIGEST_TIME_LOCAL = '08:00'
const localDateKey = (isoNow: string, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(isoNow))
const localTimeOfDay = (isoNow: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(isoNow))
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.hour}:${value.minute}`
}

export class DailyDigestService {
  constructor(
    private readonly store: AtomicStore,
    private readonly recipients: DigestRecipientPort,
    private readonly content: DigestContentPort,
    private readonly clock: DigestClock,
  ) {}

  async scan(organizationId: string, limit = 200): Promise<DailyDigestResult> {
    const now = this.clock.now()
    const recipients = await this.recipients.listActiveRecipients(organizationId, limit)
    const result: DailyDigestResult = { scanned: recipients.length, due: 0, sent: 0 }
    for (const recipient of recipients) {
      // Has this recipient's local clock reached 08:00 yet today? The per-day "already sent" marker below
      // is what actually prevents re-sending on every later scan the same day — this check only gates how
      // early in the day a scan is allowed to fire at all.
      if (localTimeOfDay(now, recipient.timezone) < DIGEST_TIME_LOCAL) continue
      result.due += 1
      const dateKey = localDateKey(now, recipient.timezone)
      const deliveryId = `${recipient.userId}-${dateKey}`
      const sent = await this.store.runTransaction(async (transaction) => {
        const markerPath = tenantDocumentPath(organizationId, 'daily_digest_delivery', deliveryId)
        if (await transaction.get(markerPath)) return false
        transaction.create(markerPath, {
          organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
          userId: recipient.userId, dateKey, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        })
        return true
      })
      if (!sent) continue
      const counts = await this.content.countForScope(organizationId, recipient.scope, now)
      const outboxId = randomUUID()
      await this.store.runTransaction(async (transaction) => {
        transaction.create(`v2Organizations/${organizationId}/_outboxEvents/${outboxId}`, {
          organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
          type: 'digest.daily', eventVersion: 1,
          payload: {
            recipientUserIds: [recipient.userId], scopeType: recipient.scope.type,
            dueToday: counts.dueToday, stalledOrOverdue: counts.stalledOrOverdue,
          },
          actorUserId: 'system:daily-digest', correlationId: deliveryId, idempotencyKey: deliveryId,
          status: 'pending', attemptCount: 0, availableAt: SERVER_TIMESTAMP, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        })
      })
      result.sent += 1
    }
    return result
  }
}

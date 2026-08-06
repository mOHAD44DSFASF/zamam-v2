import { nextRecurrenceOccurrence } from './recurrence.js'

export type NotificationDigest = 'immediate' | 'daily' | 'weekly' | 'never'
export interface QuietHours { timezone: string; start?: string; end?: string }

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const localTime = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.hour}:${value.minute}`
}

export function validateQuietHours(input: QuietHours) {
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(new Date()) }
  catch { throw new Error('NOTIFICATION_TIMEZONE_INVALID') }
  if (Boolean(input.start) !== Boolean(input.end)) throw new Error('QUIET_HOURS_INCOMPLETE')
  if (input.start && (!timePattern.test(input.start) || !timePattern.test(input.end!))) {
    throw new Error('QUIET_HOURS_INVALID')
  }
}

export function inQuietHours(now: string, input: QuietHours) {
  validateQuietHours(input)
  if (!input.start || !input.end || input.start === input.end) return false
  const current = localTime(new Date(now), input.timezone)
  return input.start < input.end
    ? current >= input.start && current < input.end
    : current >= input.start || current < input.end
}

export function nextNotificationDeliveryAt(
  now: string,
  digest: NotificationDigest,
  input: QuietHours,
) {
  validateQuietHours(input)
  if (digest === 'never') return null
  if (digest === 'daily') {
    return nextRecurrenceOccurrence({
      timezone: input.timezone, frequency: 'daily', interval: 1, timeLocal: '08:00',
    }, now)
  }
  if (digest === 'weekly') {
    return nextRecurrenceOccurrence({
      timezone: input.timezone, frequency: 'weekly', interval: 1,
      timeLocal: '08:00', daysOfWeek: [1],
    }, now)
  }
  if (!inQuietHours(now, input)) return now
  const start = Date.parse(now)
  for (let minute = 1; minute <= 1_500; minute += 1) {
    const candidate = new Date(start + minute * 60_000).toISOString()
    if (!inQuietHours(candidate, input)) return candidate
  }
  throw new Error('QUIET_HOURS_RESOLUTION_FAILED')
}

export interface NotificationEventPolicy {
  titleKey: string
  previewKey: string
  critical: boolean
  externalAllowed: boolean
  resourceType?: string
}

const eventPolicies: Readonly<Record<string, NotificationEventPolicy>> = {
  'task.created': { titleKey: 'notification.task.created', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'task' },
  'task.assigned': { titleKey: 'notification.task.assigned', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'task' },
  'task.transitioned': { titleKey: 'notification.task.transitioned', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'task' },
  'task.step_arrived': { titleKey: 'notification.task.step_arrived', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'task' },
  'task.step_sent_back': { titleKey: 'notification.task.step_sent_back', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'task' },
  'task.overdue': { titleKey: 'notification.task.overdue', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'task' },
  'review.requested': { titleKey: 'notification.review.requested', previewKey: 'notification.review_securely', critical: false, externalAllowed: true, resourceType: 'review_request' },
  'approval.requested': { titleKey: 'notification.approval.requested', previewKey: 'notification.approval_securely', critical: true, externalAllowed: true, resourceType: 'approval' },
  'approval.completed': { titleKey: 'notification.approval.completed', previewKey: 'notification.open_securely', critical: true, externalAllowed: true, resourceType: 'approval' },
  'comment.created': { titleKey: 'notification.comment.mentioned', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'comment' },
  'file.available': { titleKey: 'notification.file.available', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'attachment' },
  'file.quarantined': { titleKey: 'notification.file.quarantined', previewKey: 'notification.security_review', critical: true, externalAllowed: true, resourceType: 'attachment' },
  'leave.requested': { titleKey: 'notification.leave.requested', previewKey: 'notification.open_securely', critical: false, externalAllowed: true, resourceType: 'leave_request' },
  'security.user_disabled': { titleKey: 'notification.security.user_disabled', previewKey: 'notification.security_review', critical: true, externalAllowed: true, resourceType: 'user' },
}

export function notificationEventPolicy(eventType: string) {
  return eventPolicies[eventType] ?? null
}

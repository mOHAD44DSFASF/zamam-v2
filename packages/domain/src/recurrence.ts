import { asUtcIsoString, type UtcIsoString } from './base.js'

export interface RecurrenceRule {
  timezone: string
  frequency: 'daily' | 'weekly' | 'monthly'
  interval: number
  timeLocal: string
  daysOfWeek?: readonly number[] | undefined
  dayOfMonth?: number | undefined
}

function formatter(timezone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
  } catch { throw new Error('INVALID_TIMEZONE') }
}
function parts(date: Date, timezone: string) {
  const values = Object.fromEntries(formatter(timezone).formatToParts(date).map(({ type, value }) => [type, value]))
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  }
}
function localToUtc(local: { year: number; month: number; day: number; hour: number; minute: number }, timezone: string) {
  const desired = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  let candidate = desired
  for (let index = 0; index < 4; index += 1) {
    const actual = parts(new Date(candidate), timezone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    const delta = desired - represented
    if (delta === 0) break
    candidate += delta
  }
  const resolved = parts(new Date(candidate), timezone)
  if (resolved.year !== local.year || resolved.month !== local.month || resolved.day !== local.day
    || resolved.hour !== local.hour || resolved.minute !== local.minute) {
    // DST gap policy: advance minute-by-minute to the first valid local time on the intended date.
    for (let offset = 1; offset <= 180; offset += 1) {
      const next = new Date(desired + offset * 60_000)
      const nextLocal = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: next.getUTCHours(), minute: next.getUTCMinutes() }
      const resolvedCandidate = localToUtcExisting(nextLocal, timezone)
      if (resolvedCandidate !== null) return resolvedCandidate
    }
    throw new Error('RECURRENCE_LOCAL_TIME_INVALID')
  }
  return candidate
}
function localToUtcExisting(local: { year: number; month: number; day: number; hour: number; minute: number }, timezone: string) {
  const desired = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  let candidate = desired
  for (let index = 0; index < 4; index += 1) {
    const actual = parts(new Date(candidate), timezone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    candidate += desired - represented
  }
  const resolved = parts(new Date(candidate), timezone)
  return resolved.year === local.year && resolved.month === local.month && resolved.day === local.day
    && resolved.hour === local.hour && resolved.minute === local.minute ? candidate : null
}
function parseTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) throw new Error('INVALID_RECURRENCE_TIME')
  return { hour: Number(match[1]), minute: Number(match[2]) }
}
function addLocalDays(local: ReturnType<typeof parts>, days: number) {
  const value = new Date(Date.UTC(local.year, local.month - 1, local.day + days, local.hour, local.minute))
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), hour: value.getUTCHours(), minute: value.getUTCMinutes(), second: 0 }
}

export function nextRecurrenceOccurrence(rule: RecurrenceRule, afterUtc: string): UtcIsoString {
  const after = new Date(asUtcIsoString(afterUtc))
  formatter(rule.timezone)
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) throw new Error('INVALID_RECURRENCE_INTERVAL')
  const time = parseTime(rule.timeLocal)
  const localAfter = parts(after, rule.timezone)
  for (let dayOffset = 0; dayOffset <= 366 * 5; dayOffset += 1) {
    const day = addLocalDays(localAfter, dayOffset)
    const serial = Math.floor(Date.UTC(day.year, day.month - 1, day.day) / 86_400_000)
    let matches = false
    if (rule.frequency === 'daily') matches = serial % rule.interval === 0
    if (rule.frequency === 'weekly') {
      const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
      const week = Math.floor(serial / 7)
      matches = week % rule.interval === 0 && (rule.daysOfWeek?.includes(weekday) ?? false)
    }
    if (rule.frequency === 'monthly') matches = day.day === (rule.dayOfMonth ?? 1)
      && ((day.year * 12 + day.month - 1) % rule.interval === 0)
    if (!matches) continue
    const candidate = localToUtc({ year: day.year, month: day.month, day: day.day, ...time }, rule.timezone)
    if (candidate > after.getTime()) return asUtcIsoString(new Date(candidate).toISOString())
  }
  throw new Error('RECURRENCE_NEXT_OCCURRENCE_NOT_FOUND')
}

export function planRecurrenceCatchUp(rule: RecurrenceRule, nextRunAt: string, nowUtc: string, maxRuns = 10) {
  const now = Date.parse(asUtcIsoString(nowUtc))
  let occurrence = asUtcIsoString(nextRunAt)
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 10) throw new Error('RECURRENCE_CATCH_UP_LIMIT_INVALID')
  const due: UtcIsoString[] = []
  while (Date.parse(occurrence) <= now && due.length < maxRuns) {
    due.push(occurrence)
    occurrence = nextRecurrenceOccurrence(rule, occurrence)
  }
  return { due, nextRunAt: occurrence, truncated: Date.parse(occurrence) <= now }
}

export interface TimeInterval {
  startedAt: string
  endedAt: string
}
const utc = (value: string, code: string) => {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(code)
  }
  return parsed.getTime()
}
export function calculateTimeMinutes(interval: TimeInterval) {
  const start = utc(interval.startedAt, 'TIME_START_INVALID')
  const end = utc(interval.endedAt, 'TIME_END_INVALID')
  if (end <= start) throw new Error('TIME_RANGE_INVALID')
  if (end - start > 24 * 60 * 60 * 1_000) throw new Error('TIME_ENTRY_TOO_LONG')
  return Math.max(1, Math.round((end - start) / 60_000))
}
export function timeIntervalsOverlap(left: TimeInterval, right: TimeInterval) {
  const leftStart = utc(left.startedAt, 'TIME_START_INVALID')
  const leftEnd = utc(left.endedAt, 'TIME_END_INVALID')
  const rightStart = utc(right.startedAt, 'TIME_START_INVALID')
  const rightEnd = utc(right.endedAt, 'TIME_END_INVALID')
  return leftStart < rightEnd && rightStart < leftEnd
}
export function localDateForTimeEntry(startedAt: string, timezone: string) {
  const date = new Date(utc(startedAt, 'TIME_START_INVALID'))
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  } catch {
    throw new Error('TIMEZONE_INVALID')
  }
}

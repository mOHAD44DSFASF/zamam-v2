export type MetricKey = 'on_time_rate' | 'average_cycle_minutes' | 'review_turnaround_minutes' | 'accountable_delay_minutes'
export interface MetricSourceSnapshot {
  completedCount: number
  onTimeCount: number
  cycleMinutesTotal: number
  reviewMinutesTotal: number
  reviewCount: number
  delayMinutes: Readonly<Record<'assignee' | 'reviewer' | 'client' | 'dependency' | 'system' | 'unattributed', number>>
}
const safe = (value: number) => {
  if (!Number.isFinite(value) || value < 0) throw new Error('METRIC_SOURCE_INVALID')
  return value
}
export function calculateMetric(key: MetricKey, source: MetricSourceSnapshot) {
  for (const value of [
    source.completedCount, source.onTimeCount, source.cycleMinutesTotal,
    source.reviewMinutesTotal, source.reviewCount, ...Object.values(source.delayMinutes),
  ]) safe(value)
  if (source.onTimeCount > source.completedCount) throw new Error('METRIC_SOURCE_INVALID')
  if (key === 'on_time_rate') {
    return source.completedCount === 0 ? null
      : Math.round((source.onTimeCount / source.completedCount) * 10_000) / 100
  }
  if (key === 'average_cycle_minutes') {
    return source.completedCount === 0 ? null
      : Math.round(source.cycleMinutesTotal / source.completedCount)
  }
  if (key === 'review_turnaround_minutes') {
    return source.reviewCount === 0 ? null
      : Math.round(source.reviewMinutesTotal / source.reviewCount)
  }
  return source.delayMinutes.assignee + source.delayMinutes.unattributed
}

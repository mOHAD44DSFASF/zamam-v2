export type WorkloadStatus =
  | 'unknown'
  | 'available'
  | 'balanced'
  | 'at_risk'
  | 'overallocated'

export interface WorkloadAssignmentInput {
  id: string
  estimatedMinutes: number | null
  startsAt?: string
  dueAt?: string
}
export interface WorkloadCalculationInput {
  scheduledMinutes: number | null
  approvedLeaveMinutes: number
  holidayMinutes: number
  assignments: readonly WorkloadAssignmentInput[]
}
export interface WorkloadCalculation {
  scheduledMinutes: number | null
  absenceMinutes: number
  availableMinutes: number | null
  allocatedMinutes: number
  remainingMinutes: number | null
  utilizationPercent: number | null
  status: WorkloadStatus
  assignmentCount: number
  unknownAssignmentCount: number
  overlapCount: number
  reasons: readonly string[]
}

const finiteNonNegative = (value: number, code: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(code)
  return value
}
const instant = (value: string | undefined) => {
  if (!value) return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('WORKLOAD_ASSIGNMENT_DATE_INVALID')
  return parsed
}
export function countAssignmentOverlaps(assignments: readonly WorkloadAssignmentInput[]) {
  const intervals = assignments.map((assignment) => ({
    start: instant(assignment.startsAt),
    end: instant(assignment.dueAt),
  })).filter((value): value is { start: number; end: number } =>
    value.start !== null && value.end !== null)
  for (const interval of intervals) {
    if (interval.end < interval.start) throw new Error('WORKLOAD_ASSIGNMENT_RANGE_INVALID')
  }
  let count = 0
  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      const a = intervals[left]
      const b = intervals[right]
      if (a && b && a.start <= b.end && b.start <= a.end) count += 1
    }
  }
  return count
}

export function calculateWorkload(input: WorkloadCalculationInput): WorkloadCalculation {
  const leave = finiteNonNegative(input.approvedLeaveMinutes, 'WORKLOAD_LEAVE_INVALID')
  const holidays = finiteNonNegative(input.holidayMinutes, 'WORKLOAD_HOLIDAY_INVALID')
  const scheduled = input.scheduledMinutes === null
    ? null
    : finiteNonNegative(input.scheduledMinutes, 'WORKLOAD_SCHEDULE_INVALID')
  const known = input.assignments.filter(({ estimatedMinutes }) => estimatedMinutes !== null)
  for (const assignment of known) {
    finiteNonNegative(assignment.estimatedMinutes!, 'WORKLOAD_ESTIMATE_INVALID')
  }
  const allocatedMinutes = known.reduce(
    (sum, assignment) => sum + assignment.estimatedMinutes!, 0,
  )
  const unknownAssignmentCount = input.assignments.length - known.length
  const absenceMinutes = leave + holidays
  const availableMinutes = scheduled === null ? null : Math.max(0, scheduled - absenceMinutes)
  const remainingMinutes = availableMinutes === null ? null : availableMinutes - allocatedMinutes
  const utilizationPercent = availableMinutes === null
    ? null
    : availableMinutes === 0
      ? allocatedMinutes === 0 ? 0 : 999
      : Math.round((allocatedMinutes / availableMinutes) * 100)
  const overlapCount = countAssignmentOverlaps(input.assignments)
  const reasons: string[] = []
  if (scheduled === null) reasons.push('capacity_unknown')
  if (unknownAssignmentCount > 0) reasons.push('estimate_unknown')
  if (absenceMinutes > (scheduled ?? Number.POSITIVE_INFINITY)) reasons.push('absence_exceeds_schedule')
  if (overlapCount > 0) reasons.push('assignment_overlap')
  let status: WorkloadStatus = 'unknown'
  if (scheduled !== null && unknownAssignmentCount === 0) {
    if ((utilizationPercent ?? 0) <= 70) status = 'available'
    else if ((utilizationPercent ?? 0) <= 90) status = 'balanced'
    else if ((utilizationPercent ?? 0) <= 110) status = 'at_risk'
    else status = 'overallocated'
  }
  return {
    scheduledMinutes: scheduled, absenceMinutes, availableMinutes, allocatedMinutes,
    remainingMinutes, utilizationPercent, status,
    assignmentCount: input.assignments.length, unknownAssignmentCount, overlapCount,
    reasons,
  }
}

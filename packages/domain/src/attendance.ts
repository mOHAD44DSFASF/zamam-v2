export function leaveDaysInclusive(startsOn: string, endsOn: string) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/
  if (!pattern.test(startsOn) || !pattern.test(endsOn)) throw new Error('LEAVE_DATE_INVALID')
  const start = Date.parse(`${startsOn}T00:00:00.000Z`)
  const end = Date.parse(`${endsOn}T00:00:00.000Z`)
  if (end < start) throw new Error('LEAVE_RANGE_INVALID')
  return Math.floor((end - start) / 86_400_000) + 1
}
export function leaveRangesOverlap(
  left: { startsOn: string; endsOn: string },
  right: { startsOn: string; endsOn: string },
) {
  leaveDaysInclusive(left.startsOn, left.endsOn)
  leaveDaysInclusive(right.startsOn, right.endsOn)
  return left.startsOn <= right.endsOn && right.startsOn <= left.endsOn
}
export function deriveAttendanceStatus(input: {
  scheduledMinutes: number
  holiday: boolean
  approvedLeave: boolean
  checkInAt?: string
  checkOutAt?: string
  scheduledStartAt?: string
}) {
  if (input.holiday) return { status: 'holiday' as const, workedMinutes: 0 }
  if (input.approvedLeave) return { status: 'leave' as const, workedMinutes: 0 }
  if (!input.checkInAt || !input.checkOutAt) {
    return { status: 'absent' as const, workedMinutes: 0 }
  }
  const start = Date.parse(input.checkInAt)
  const end = Date.parse(input.checkOutAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('ATTENDANCE_RANGE_INVALID')
  }
  const workedMinutes = Math.round((end - start) / 60_000)
  const late = input.scheduledStartAt
    ? start > Date.parse(input.scheduledStartAt) + 5 * 60_000
    : false
  if (late) return { status: 'late' as const, workedMinutes }
  if (workedMinutes < input.scheduledMinutes) {
    return { status: 'partial' as const, workedMinutes }
  }
  return { status: 'present' as const, workedMinutes }
}

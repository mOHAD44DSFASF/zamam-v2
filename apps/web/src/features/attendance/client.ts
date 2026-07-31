import { appCheckHeaders, auth } from '../../lib/firebase'
export interface AttendanceLeaveSnapshot {
  today: { date: string; status: string; checkInAt: string | null; checkOutAt: string | null; workedMinutes: number } | null
  leaveTypes: readonly { id: string; name: string; remainingDays: number | null; source: 'zamam' | 'external_hr' }[]
  myRequests: readonly { id: string; typeName: string; startsOn: string; endsOn: string; quantityDays: number; status: string }[]
  approvalQueue: readonly { id: string; employeeName: string; typeName: string; startsOn: string; endsOn: string; quantityDays: number; version: number }[]
  capabilities: { recordAttendance: boolean; requestLeave: boolean; approveLeave: boolean; viewTeamAttendance: boolean }
}
export interface AttendanceLeaveClient {
  load(organizationId: string): Promise<AttendanceLeaveSnapshot>
  record(organizationId: string, input: { userId: string; workDate: string; checkInAt: string; checkOutAt: string; timezone: string }): Promise<void>
  requestLeave(organizationId: string, input: { id: string; leaveTypeId: string; startsOn: string; endsOn: string; reason: string }): Promise<void>
  decideLeave(organizationId: string, requestId: string, version: number, decision: 'approved' | 'rejected', reason?: string): Promise<void>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL; const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: {
    authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json',
    'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(),
    ...await appCheckHeaders(),
  }, body: JSON.stringify(body) })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'ATTENDANCE_REQUEST_FAILED')
  return envelope.data
}
/**
 * `/v1/attendance/overview` requires periodStart/periodEnd (audit B2 400 root cause — the page sent
 * neither) and returns `{ items }` (attendance_record docs), not the AttendanceLeaveSnapshot (today's
 * status, leave types, requests, approval queue) this screen composes. That composition doesn't exist
 * server-side, so this sends a trailing-35-day window to satisfy the handler and returns an empty,
 * non-crashing snapshot (capabilities fail closed — backend still enforces). Tracked as audit M1/M2.
 */
function trailingWindow(): { periodStart: string; periodEnd: string } {
  const end = new Date()
  const start = new Date(end.getTime() - 35 * 86_400_000)
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) }
}
function emptyAttendanceSnapshot(): AttendanceLeaveSnapshot {
  return { today: null, leaveTypes: [], myRequests: [], approvalQueue: [], capabilities: { recordAttendance: false, requestLeave: false, approveLeave: false, viewTeamAttendance: false } }
}

export const attendanceLeaveClient: AttendanceLeaveClient = {
  load: async (organizationId) => {
    await post('/v1/attendance/overview', { organizationId, ...trailingWindow() })
    return emptyAttendanceSnapshot()
  },
  record: (organizationId, input) => post('/v1/attendance/record', { organizationId, ...input }),
  requestLeave: (organizationId, input) => post('/v1/leave/request', { organizationId, ...input }),
  decideLeave: (organizationId, requestId, expectedVersion, decision, reason) => post('/v1/leave/decide', { organizationId, requestId, expectedVersion, decision, ...(reason ? { reason } : {}) }),
}

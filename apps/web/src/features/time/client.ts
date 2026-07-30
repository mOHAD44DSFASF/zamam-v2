import { appCheckHeaders, auth } from '../../lib/firebase'

export interface TimeEntrySummary {
  id: string
  projectId: string
  projectName: string
  taskId: string | null
  taskTitle: string | null
  startedAt: string
  endedAt: string | null
  minutes: number
  billable: boolean
  note: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  version: number
}
export interface TimesheetSummary {
  id: string
  userId: string
  userName: string
  periodStart: string
  periodEnd: string
  totalMinutes: number
  entryCount: number
  status: 'open' | 'submitted' | 'approved' | 'rejected' | 'locked'
  version: number
}
export interface TimeSnapshot {
  timezone: string
  periodStart: string
  periodEnd: string
  runningEntry: TimeEntrySummary | null
  entries: readonly TimeEntrySummary[]
  timesheet: TimesheetSummary | null
  approvalQueue: readonly TimesheetSummary[]
  projects: readonly { id: string; name: string }[]
  capabilities: {
    track: boolean
    submit: boolean
    approve: boolean
    viewBillable: boolean
    requestCorrection: boolean
  }
}
export interface TimeClient {
  load(organizationId: string, periodStart: string): Promise<TimeSnapshot>
  start(organizationId: string, input: {
    id: string; projectId: string; timezone: string; billable: boolean
  }): Promise<void>
  stop(organizationId: string, entryId: string, expectedVersion: number): Promise<void>
  createManual(organizationId: string, input: {
    id: string; projectId: string; startedAt: string; endedAt: string;
    timezone: string; billable: boolean; note?: string
  }): Promise<void>
  submit(organizationId: string, periodStart: string, periodEnd: string): Promise<void>
  decide(
    organizationId: string, timesheetId: string, expectedVersion: number,
    decision: 'approved' | 'rejected', reason?: string,
  ): Promise<void>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL
  const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
      'x-idempotency-key': crypto.randomUUID(),
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) {
    throw new Error(envelope.error?.code ?? 'TIME_REQUEST_FAILED')
  }
  return envelope.data
}
export const timeClient: TimeClient = {
  load: (organizationId, periodStart) =>
    post('/v1/time/query', { organizationId, periodStart, limit: 50 }),
  start: (organizationId, input) =>
    post('/v1/time/timer/start', { organizationId, ...input }),
  stop: (organizationId, entryId, expectedVersion) =>
    post('/v1/time/timer/stop', { organizationId, entryId, expectedVersion }),
  createManual: (organizationId, input) =>
    post('/v1/time/entries/create', { organizationId, ...input }),
  submit: (organizationId, periodStart, periodEnd) =>
    post('/v1/timesheets/submit', { organizationId, periodStart, periodEnd }),
  decide: (organizationId, timesheetId, expectedVersion, decision, reason) =>
    post('/v1/timesheets/decide', {
      organizationId, timesheetId, expectedVersion, decision, ...(reason ? { reason } : {}),
    }),
}

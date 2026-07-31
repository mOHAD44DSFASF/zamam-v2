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
interface RawTimeEntry {
  id?: unknown; projectId?: unknown; startedAt?: unknown; endedAt?: unknown; minutes?: unknown
  billable?: unknown; note?: unknown; status?: unknown; timerState?: unknown; version?: unknown
}

// The 6-day weekly window the timesheet period spans; the handler requires periodEnd, which the page
// never supplied (the audit B1 400 root cause).
function weekEnd(periodStart: string): string {
  const start = new Date(`${periodStart}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) return periodStart
  const end = new Date(start.getTime() + 6 * 86_400_000)
  return end.toISOString().slice(0, 10)
}

/**
 * `/v1/time/query` returns `{ items, nextCursor }` — raw time_entry docs, not the TimeSnapshot (running
 * entry, timesheet, approval queue, projects, capabilities) this screen expects. Adapter maps the real
 * entries into a valid snapshot; a running entry is derived from any entry whose timer is running,
 * timesheet/queue/projects empty, capabilities fail closed (backend still enforces). Tracked as M1/M2.
 */
function toTimeEntry(row: RawTimeEntry): TimeEntrySummary {
  return {
    id: String(row.id ?? ''), projectId: String(row.projectId ?? ''), projectName: String(row.projectId ?? ''),
    taskId: null, taskTitle: null,
    startedAt: typeof row.startedAt === 'string' ? row.startedAt : '',
    endedAt: typeof row.endedAt === 'string' ? row.endedAt : null,
    minutes: typeof row.minutes === 'number' ? row.minutes : 0, billable: Boolean(row.billable),
    note: typeof row.note === 'string' ? row.note : '',
    status: (typeof row.status === 'string' ? row.status : 'draft') as TimeEntrySummary['status'],
    version: typeof row.version === 'number' ? row.version : 1,
  }
}
function toTimeSnapshot(raw: { items?: readonly RawTimeEntry[]; capabilities?: TimeSnapshot['capabilities'] }, periodStart: string): TimeSnapshot {
  const rows = raw.items ?? []
  const runningRaw = rows.find((row) => row.timerState === 'running')
  return {
    timezone: 'Asia/Riyadh', periodStart, periodEnd: weekEnd(periodStart),
    runningEntry: runningRaw ? toTimeEntry(runningRaw) : null,
    entries: rows.map(toTimeEntry), timesheet: null, approvalQueue: [], projects: [],
    capabilities: raw.capabilities ?? { track: false, submit: false, approve: false, viewBillable: false, requestCorrection: false },
  }
}

export const timeClient: TimeClient = {
  load: async (organizationId, periodStart) =>
    toTimeSnapshot(await post('/v1/time/query', { organizationId, periodStart, periodEnd: weekEnd(periodStart), limit: 50 }), periodStart),
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

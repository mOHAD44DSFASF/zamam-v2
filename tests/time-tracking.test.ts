import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import {
  calculateTimeMinutes, localDateForTimeEntry, timeIntervalsOverlap,
} from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  TimeTrackingService, buildTimeEntryQuery,
  type TimeAuthorizationGate, type TimeLookupPort, type TimeMetadata,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => { if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: ${path}`); return working.get(path) ?? null },
      create: (path, data) => {
        writeStarted = true
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
        writeStarted = true
        const current = working.get(path)
        if (!current) throw new Error('NOT_FOUND')
        working.set(path, { ...current, ...data })
      },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}
class Gate implements TimeAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
  }
}
const member: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
const manager: AuthorizationPrincipal = { ...member, userId: 'manager-1' }
let sequence = 0
const metadata = (principal = member): TimeMetadata => ({
  organizationId: 'org-1', principal, correlationId: `correlation-${++sequence}`,
  idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const timeRecords = (store: MemoryStore) => [...store.records.entries()]
  .filter(([path]) => path.includes('/time_entry/'))
  .map(([path, record]) => ({ ...record, id: path.split('/').at(-1)! }))
function lookup(store: MemoryStore): TimeLookupPort {
  return {
    findRunning: async (organizationId, userId) => timeRecords(store).find(
      (record) => record.organizationId === organizationId
        && record.userId === userId && record.timerState === 'running',
    ) ?? null,
    getEntry: async (organizationId, entryId) => {
      const record = store.records.get(`v2Organizations/${organizationId}/time_entry/${entryId}`)
      return record ? { ...record, id: entryId } : null
    },
    getTimesheet: async (organizationId, sheetId) => {
      const record = store.records.get(`v2Organizations/${organizationId}/timesheet/${sheetId}`)
      return record ? { ...record, id: sheetId } : null
    },
    getCorrection: async (organizationId, correctionId) => {
      const record = store.records.get(`v2Organizations/${organizationId}/time_correction/${correctionId}`)
      return record ? { ...record, id: correctionId } : null
    },
    listPeriodEntries: async (_organizationId, userId, periodStart, periodEnd) =>
      timeRecords(store).filter((record) =>
        record.userId === userId
        && String(record.localDate) >= periodStart
        && String(record.localDate) <= periodEnd),
    hasOverlap: async (_organizationId, userId, startedAt, endedAt, excludeEntryId) =>
      timeRecords(store).some((record) =>
        record.userId === userId && record.id !== excludeEntryId
        && typeof record.endedAt === 'string'
        && timeIntervalsOverlap(
          { startedAt, endedAt },
          { startedAt: String(record.startedAt), endedAt: record.endedAt },
        )),
  }
}
function fixture(now = '2026-08-03T08:00:00.000Z') {
  const store = new MemoryStore()
  const gate = new Gate()
  let current = now
  const service = new TimeTrackingService(
    store, gate, lookup(store), { now: () => current },
  )
  return { store, gate, service, setNow: (value: string) => { current = value } }
}
const manual = (id: string, startedAt: string, endedAt: string) => ({
  id, projectId: 'project-1', taskId: 'task-1', billable: false,
  note: 'Work record', timezone: 'Africa/Cairo', startedAt, endedAt,
})

describe('time domain rules', () => {
  it('rounds to the nearest minute and uses half-open overlap intervals', () => {
    expect(calculateTimeMinutes({
      startedAt: '2026-08-03T08:00:00.000Z',
      endedAt: '2026-08-03T08:30:31.000Z',
    })).toBe(31)
    expect(timeIntervalsOverlap(
      { startedAt: '2026-08-03T08:00:00.000Z', endedAt: '2026-08-03T09:00:00.000Z' },
      { startedAt: '2026-08-03T09:00:00.000Z', endedAt: '2026-08-03T10:00:00.000Z' },
    )).toBe(false)
  })
  it('derives the work date in the employee timezone', () => {
    expect(localDateForTimeEntry(
      '2026-08-02T22:30:00.000Z', 'Africa/Cairo',
    )).toBe('2026-08-03')
  })
})

describe('timer and manual entries', () => {
  it('starts idempotently, prevents a second timer, and stops with computed minutes', async () => {
    const context = fixture()
    const command = metadata()
    const input = {
      id: 'time-1', projectId: 'project-1', taskId: 'task-1',
      billable: false, timezone: 'Africa/Cairo',
    }
    const first = await context.service.startTimer(command, input)
    const replay = await context.service.startTimer(command, input)
    expect(replay).toEqual({ ...first, replayed: true })
    await expect(context.service.startTimer(metadata(), {
      ...input, id: 'time-2',
    })).rejects.toThrow('TIME_TIMER_ALREADY_RUNNING')
    context.setNow('2026-08-03T08:45:00.000Z')
    expect(await context.service.stopTimer(metadata(), 'time-1', 1))
      .toMatchObject({ result: { minutes: 45, version: 2 } })
  })

  it('rejects overlapping manual entries and future time', async () => {
    const context = fixture('2026-08-04T12:00:00.000Z')
    await context.service.createManual(metadata(), manual(
      'time-1', '2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z',
    ))
    await expect(context.service.createManual(metadata(), manual(
      'time-2', '2026-08-03T08:30:00.000Z', '2026-08-03T09:30:00.000Z',
    ))).rejects.toThrow('TIME_ENTRY_OVERLAP')
    await expect(context.service.createManual(metadata(), manual(
      'time-3', '2026-08-05T08:00:00.000Z', '2026-08-05T09:00:00.000Z',
    ))).rejects.toThrow('TIME_ENTRY_FUTURE_DENIED')
  })
})

describe('timesheets and immutable corrections', () => {
  it('submits and approves a period, then creates a replacement without mutating original evidence', async () => {
    const context = fixture('2026-08-10T12:00:00.000Z')
    await context.service.createManual(metadata(), manual(
      'time-1', '2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z',
    ))
    await context.service.createManual(metadata(), manual(
      'time-2', '2026-08-04T08:00:00.000Z', '2026-08-04T09:30:00.000Z',
    ))
    const submitted = await context.service.submitTimesheet(
      metadata(), '2026-08-03', '2026-08-09',
    )
    expect(submitted.result).toMatchObject({ totalMinutes: 150, entryCount: 2 })
    const sheetId = submitted.result.timesheetId
    await context.service.decideTimesheet(metadata(manager), sheetId, {
      expectedVersion: 1, decision: 'approved',
    })
    const originalBefore = {
      ...context.store.records.get('v2Organizations/org-1/time_entry/time-1'),
    }
    await expect(context.service.submitTimesheet(
      metadata(), '2026-08-03', '2026-08-09',
    )).rejects.toThrow('TIMESHEET_ENTRY_NOT_SUBMITTABLE')
    await context.service.requestCorrection(metadata(), {
      id: 'correction-1', entryId: 'time-1', reason: 'Incorrect end time',
      proposedStartedAt: '2026-08-03T08:00:00.000Z',
      proposedEndedAt: '2026-08-03T09:15:00.000Z',
      proposedNote: 'Corrected work record',
    })
    const decision = await context.service.decideCorrection(metadata(manager), 'correction-1', {
      expectedVersion: 1, decision: 'approved',
    })
    expect(context.store.records.get('v2Organizations/org-1/time_entry/time-1'))
      .toEqual(originalBefore)
    const replacementId = decision.result.replacementEntryId!
    expect(context.store.records.get(`v2Organizations/org-1/time_entry/${replacementId}`))
      .toMatchObject({
        status: 'approved', minutes: 75, supersedesEntryId: 'time-1',
      })
    expect(context.gate.requests.some(({ permission }) => permission === 'time.adjust')).toBe(true)
  })

  it('prevents self approval and requires a rejection reason', async () => {
    const context = fixture('2026-08-10T12:00:00.000Z')
    await context.service.createManual(metadata(), manual(
      'time-1', '2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z',
    ))
    const submitted = await context.service.submitTimesheet(
      metadata(), '2026-08-03', '2026-08-09',
    )
    await expect(context.service.decideTimesheet(
      metadata(), submitted.result.timesheetId,
      { expectedVersion: 1, decision: 'approved' },
    )).rejects.toThrow('TIMESHEET_SELF_APPROVAL_DENIED')
    await expect(context.service.decideTimesheet(
      metadata(manager), submitted.result.timesheetId,
      { expectedVersion: 1, decision: 'rejected' },
    )).rejects.toThrow('TIMESHEET_REJECTION_REASON_REQUIRED')
  })
})

describe('time entry query', () => {
  it('is bounded and ordered by local work date then start time', () => {
    expect(buildTimeEntryQuery({
      organizationId: 'org-1', userId: 'user-1',
      periodStart: '2026-08-03', periodEnd: '2026-08-09',
    })).toMatchObject({
      entityKind: 'time_entry', limit: 50,
      orderBy: [
        { field: 'localDate', direction: 'desc' },
        { field: 'startedAt', direction: 'desc' },
      ],
    })
  })
})

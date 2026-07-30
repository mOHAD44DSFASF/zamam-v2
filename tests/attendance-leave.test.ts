import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { deriveAttendanceStatus, leaveDaysInclusive, leaveRangesOverlap } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  AttendanceService, LeaveService,
  type AttendanceGate, type AttendanceMetadata,
  type LeaveApproverResolver, type LeaveGate, type LeaveLookup, type LeaveMetadata,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => { if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: ${path}`); return working.get(path) ?? null },
      create: (path, data) => { writeStarted = true; if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, { ...data }) },
      update: (path, data) => { writeStarted = true; const current = working.get(path); if (!current) throw new Error('NOT_FOUND'); working.set(path, { ...current, ...data }) },
    }
    const result = await operation(transaction); this.records = working; return result
  }
}
class Gate implements AttendanceGate, LeaveGate {
  requests: AuthorizationRequest[] = []
  denied = false
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    if (this.denied) throw new Error('AUTHORIZATION_DENIED')
    this.requests.push(request)
  }
}
const member: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
const leader = { ...member, userId: 'leader-1' }
const departmentManager = { ...member, userId: 'department-manager-1' }
let sequence = 0
const attendanceMetadata = (principal = member): AttendanceMetadata => ({
  organizationId: 'org-1', principal, correlationId: `correlation-${++sequence}`,
  idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const leaveMetadata = (principal = member): LeaveMetadata => attendanceMetadata(principal)

describe('attendance derivation', () => {
  it('gives holiday priority over leave and recorded check-in', () => {
    expect(deriveAttendanceStatus({
      scheduledMinutes: 480, holiday: true, approvedLeave: true,
      checkInAt: '2026-08-03T08:00:00.000Z', checkOutAt: '2026-08-03T16:00:00.000Z',
    })).toEqual({ status: 'holiday', workedMinutes: 0 })
  })
  it('detects late and partial records without location data', () => {
    expect(deriveAttendanceStatus({
      scheduledMinutes: 480, holiday: false, approvedLeave: false,
      scheduledStartAt: '2026-08-03T08:00:00.000Z',
      checkInAt: '2026-08-03T08:10:00.000Z', checkOutAt: '2026-08-03T14:00:00.000Z',
    })).toEqual({ status: 'late', workedMinutes: 350 })
  })
})

describe('manual attendance and corrections', () => {
  it('records self attendance and preserves correction evidence', async () => {
    const store = new MemoryStore(); const gate = new Gate()
    const get = async (organizationId: string, id: string) =>
      store.records.get(`v2Organizations/${organizationId}/attendance_record/${id}`) ?? null
    const service = new AttendanceService(store, gate, { get })
    const input = {
      userId: 'user-1', workDate: '2026-08-03', scheduledMinutes: 480,
      holiday: false, approvedLeave: false,
      checkInAt: '2026-08-03T08:00:00.000Z', checkOutAt: '2026-08-03T14:00:00.000Z',
    }
    const first = await service.record(attendanceMetadata(), input)
    expect(first.result.status).toBe('partial')
    await service.correct(attendanceMetadata(departmentManager), first.result.recordId, 1, {
      ...input, checkOutAt: '2026-08-03T16:00:00.000Z', reason: 'Approved missing checkout',
    })
    expect(await get('org-1', first.result.recordId)).toMatchObject({
      status: 'present', source: 'correction', version: 2,
    })
    expect([...store.records.values()].find((record) => record.attendanceRecordId === first.result.recordId))
      .toMatchObject({ beforeStatus: 'partial', afterStatus: 'present', reason: 'Approved missing checkout' })
    expect(gate.requests.at(-1)?.permission).toBe('attendance.manage')
  })
})

describe('leave approval and balance ledger', () => {
  function fixture() {
    const store = new MemoryStore(); const gate = new Gate()
    const balanceId = 'balance-2026-user-1-leave-type-1'
    store.records.set(`v2Organizations/org-1/leave_balance/${balanceId}`, {
      id: balanceId, organizationId: 'org-1', userId: 'user-1',
      leaveTypeId: 'leave-type-1', year: 2026, allowanceDays: 20,
      usedDays: 2, pendingDays: 0, source: 'zamam', version: 1,
    })
    const lookup: LeaveLookup = {
      getRequest: async (organizationId, requestId) => {
        const value = store.records.get(`v2Organizations/${organizationId}/leave_request/${requestId}`)
        return value ? { ...value, id: requestId } : null
      },
      getBalance: async (organizationId, id) =>
        store.records.get(`v2Organizations/${organizationId}/leave_balance/${id}`) ?? null,
      hasOverlap: async () => false,
    }
    const approvers: LeaveApproverResolver = {
      resolve: async (_organizationId, _userId, days) =>
        days > 3 ? ['leader-1', 'department-manager-1'] : ['leader-1'],
    }
    return { store, gate, balanceId, service: new LeaveService(store, gate, lookup, approvers) }
  }
  it('uses inclusive dates and rejects overlapping ranges', () => {
    expect(leaveDaysInclusive('2026-08-03', '2026-08-07')).toBe(5)
    expect(leaveRangesOverlap(
      { startsOn: '2026-08-03', endsOn: '2026-08-07' },
      { startsOn: '2026-08-07', endsOn: '2026-08-08' },
    )).toBe(true)
  })
  it('reserves once, enforces ordered approval, and consumes once on final approval', async () => {
    const context = fixture()
    await context.service.request(leaveMetadata(), {
      id: 'leave-request-1', leaveTypeId: 'leave-type-1',
      startsOn: '2026-08-03', endsOn: '2026-08-07', reason: 'Annual leave',
    })
    expect(context.store.records.get(`v2Organizations/org-1/leave_balance/${context.balanceId}`))
      .toMatchObject({ usedDays: 2, pendingDays: 5 })
    await expect(context.service.decide(
      leaveMetadata(departmentManager), 'leave-request-1', 1, 'approved',
    )).rejects.toThrow('LEAVE_APPROVER_ORDER_DENIED')
    expect((await context.service.decide(
      leaveMetadata(leader), 'leave-request-1', 1, 'approved',
    )).result.status).toBe('submitted')
    expect((await context.service.decide(
      leaveMetadata(departmentManager), 'leave-request-1', 2, 'approved',
    )).result.status).toBe('approved')
    expect(context.store.records.get(`v2Organizations/org-1/leave_balance/${context.balanceId}`))
      .toMatchObject({ usedDays: 7, pendingDays: 0 })
    expect([...context.store.records.values()].filter((record) =>
      record.operation === 'consume' && record.leaveRequestId === 'leave-request-1')).toHaveLength(1)
  })
  it('fails closed for external HR balances and denied manager scope', async () => {
    const context = fixture()
    context.store.records.set(`v2Organizations/org-1/leave_balance/${context.balanceId}`, {
      ...context.store.records.get(`v2Organizations/org-1/leave_balance/${context.balanceId}`)!,
      source: 'external_hr',
    })
    await expect(context.service.request(leaveMetadata(), {
      id: 'leave-request-1', leaveTypeId: 'leave-type-1',
      startsOn: '2026-08-03', endsOn: '2026-08-03', reason: 'Annual leave',
    })).rejects.toThrow('LEAVE_EXTERNAL_HR_READ_ONLY')
    context.gate.denied = true
    context.store.records.set(`v2Organizations/org-1/leave_balance/${context.balanceId}`, {
      ...context.store.records.get(`v2Organizations/org-1/leave_balance/${context.balanceId}`)!,
      source: 'zamam',
    })
    await expect(context.service.request(leaveMetadata(), {
      id: 'leave-request-2', leaveTypeId: 'leave-type-1',
      startsOn: '2026-08-04', endsOn: '2026-08-04', reason: 'Annual leave',
    })).rejects.toThrow('AUTHORIZATION_DENIED')
  })
})

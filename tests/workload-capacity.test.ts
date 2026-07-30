import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { calculateWorkload } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  WorkloadProjectionService, buildWorkloadQuery, workloadViewPermission,
  type WorkloadAuthorizationGate, type WorkloadMetadata, type WorkloadSourcePort,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    const transaction: AtomicTransaction = {
      get: async (path) => working.get(path) ?? null,
      create: (path, data) => {
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
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
class Gate implements WorkloadAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
  }
}
const principal: AuthorizationPrincipal = {
  userId: 'manager-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (): WorkloadMetadata => ({
  organizationId: 'org-1', principal, correlationId: `correlation-${++sequence}`,
  idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})

describe('workload calculation', () => {
  it('subtracts leave and holidays from a part-time schedule', () => {
    expect(calculateWorkload({
      scheduledMinutes: 1_200, approvedLeaveMinutes: 240, holidayMinutes: 120,
      assignments: [{ id: 'task-1', estimatedMinutes: 600 }],
    })).toMatchObject({
      availableMinutes: 840, allocatedMinutes: 600, remainingMinutes: 240,
      utilizationPercent: 71, status: 'balanced', absenceMinutes: 360,
    })
  })

  it('reports overlapping assignment windows as explainable conflicts', () => {
    const result = calculateWorkload({
      scheduledMinutes: 2_400, approvedLeaveMinutes: 0, holidayMinutes: 0,
      assignments: [
        { id: 'task-1', estimatedMinutes: 600, startsAt: '2026-08-01T08:00:00.000Z', dueAt: '2026-08-03T17:00:00.000Z' },
        { id: 'task-2', estimatedMinutes: 600, startsAt: '2026-08-03T08:00:00.000Z', dueAt: '2026-08-04T17:00:00.000Z' },
      ],
    })
    expect(result.overlapCount).toBe(1)
    expect(result.reasons).toContain('assignment_overlap')
  })

  it('keeps missing schedule and missing estimates unknown rather than zero', () => {
    const noSchedule = calculateWorkload({
      scheduledMinutes: null, approvedLeaveMinutes: 0, holidayMinutes: 0,
      assignments: [{ id: 'task-1', estimatedMinutes: 300 }],
    })
    expect(noSchedule).toMatchObject({
      status: 'unknown', availableMinutes: null, utilizationPercent: null,
      allocatedMinutes: 300,
    })
    const noEstimate = calculateWorkload({
      scheduledMinutes: 2_400, approvedLeaveMinutes: 0, holidayMinutes: 0,
      assignments: [{ id: 'task-1', estimatedMinutes: null }],
    })
    expect(noEstimate).toMatchObject({
      status: 'unknown', unknownAssignmentCount: 1, availableMinutes: 2_400,
    })
    expect(noEstimate.reasons).toContain('estimate_unknown')
  })

  it('classifies overload using available capacity after absence', () => {
    expect(calculateWorkload({
      scheduledMinutes: 2_400, approvedLeaveMinutes: 480, holidayMinutes: 0,
      assignments: [{ id: 'task-1', estimatedMinutes: 2_200 }],
    })).toMatchObject({ utilizationPercent: 115, status: 'overallocated' })
  })
})

describe('workload projection boundary', () => {
  it('builds privacy-minimized, audited projections in the requested team scope', async () => {
    const store = new MemoryStore()
    const gate = new Gate()
    const source: WorkloadSourcePort = {
      listMembers: async () => [{ userId: 'user-1', displayName: 'Member One', teamId: 'team-1' }],
      scheduledMinutes: async () => 2_400,
      approvedAbsenceMinutes: async () => ({ leaveMinutes: 480, holidayMinutes: 0 }),
      assignments: async () => [{ id: 'task-1', estimatedMinutes: 1_200 }],
    }
    const service = new WorkloadProjectionService(store, gate, source)
    const result = await service.rebuild(metadata(), {
      periodStart: '2026-08-03', periodEnd: '2026-08-09',
      scopeType: 'team', scopeId: 'team-1',
    })
    expect(result.result).toEqual({
      periodStart: '2026-08-03', periodEnd: '2026-08-09', count: 1, unknownCount: 0,
    })
    expect(gate.requests[0]).toMatchObject({
      permission: 'workload.manage', resource: { type: 'team', teamId: 'team-1' },
    })
    const projection = store.records.get(
      'v2Organizations/org-1/capacity_plan/capacity-20260803-user-1',
    )
    expect(projection).toMatchObject({
      userId: 'user-1', absenceMinutes: 480, availableMinutes: 1_920,
      allocatedMinutes: 1_200, status: 'available', scopeType: 'team', scopeId: 'team-1',
    })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('leaveType')
    expect(serialized).not.toContain('leaveReason')
  })

  it('rejects oversized projection batches before a write', async () => {
    const store = new MemoryStore()
    const source: WorkloadSourcePort = {
      listMembers: async () => Array.from({ length: 101 }, (_, index) => ({
        userId: `user-${index}`, displayName: `Member ${index}`,
      })),
      scheduledMinutes: async () => 2_400,
      approvedAbsenceMinutes: async () => ({ leaveMinutes: 0, holidayMinutes: 0 }),
      assignments: async () => [],
    }
    const service = new WorkloadProjectionService(store, new Gate(), source)
    await expect(service.rebuild(metadata(), {
      periodStart: '2026-08-03', periodEnd: '2026-08-09',
      scopeType: 'organization', scopeId: 'org-1',
    })).rejects.toThrow('WORKLOAD_REBUILD_TOO_LARGE')
    expect(store.records.size).toBe(0)
  })

  it('defines scoped permissions and a bounded explainable read query', () => {
    expect(workloadViewPermission('self')).toBe('workload.view_self')
    expect(workloadViewPermission('team')).toBe('workload.view_team')
    expect(workloadViewPermission('organization')).toBe('workload.view_organization')
    expect(buildWorkloadQuery({
      organizationId: 'org-1', scopeType: 'team', scopeId: 'team-1',
      periodStart: '2026-08-03',
    })).toMatchObject({
      entityKind: 'capacity_plan', limit: 50,
      orderBy: [{ field: 'utilizationPercent', direction: 'desc' }, { field: 'userId', direction: 'asc' }],
    })
    expect(() => buildWorkloadQuery({
      organizationId: 'org-1', scopeType: 'team', scopeId: 'team-1',
      periodStart: '2026-08-03', limit: 51,
    })).toThrow('UNBOUNDED_QUERY_DENIED')
  })
})

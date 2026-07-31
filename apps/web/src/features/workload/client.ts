import { appCheckHeaders, auth } from '../../lib/firebase'

export type WorkloadStatus = 'unknown' | 'available' | 'balanced' | 'at_risk' | 'overallocated'
export interface WorkloadRow {
  userId: string
  displayName: string
  status: WorkloadStatus
  scheduledMinutes: number | null
  absenceMinutes: number
  availableMinutes: number | null
  allocatedMinutes: number
  remainingMinutes: number | null
  utilizationPercent: number | null
  assignmentCount: number
  unknownAssignmentCount: number
  overlapCount: number
  reasons: readonly string[]
  calculatedAt: string
}
export interface WorkloadScope {
  type: 'organization' | 'department' | 'team'
  id: string
  label: string
}
export interface WorkloadSnapshot {
  periodStart: string
  periodEnd: string
  scope: WorkloadScope
  availableScopes: readonly WorkloadScope[]
  rows: readonly WorkloadRow[]
  summary: {
    knownPeople: number
    unknownPeople: number
    overallocatedPeople: number
    totalAvailableMinutes: number
    totalAllocatedMinutes: number
  }
  capabilities: { viewEmployeeNames: boolean; rebuild: boolean }
}
export interface WorkloadClient {
  load(
    organizationId: string, scope: WorkloadScope, periodStart: string,
  ): Promise<WorkloadSnapshot>
  rebuild(
    organizationId: string, scope: WorkloadScope,
    periodStart: string, periodEnd: string,
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
    throw new Error(envelope.error?.code ?? 'WORKLOAD_REQUEST_FAILED')
  }
  return envelope.data
}
interface RawCapacityRow {
  userId?: unknown; displayName?: unknown; status?: unknown; scheduledMinutes?: unknown; absenceMinutes?: unknown
  availableMinutes?: unknown; allocatedMinutes?: unknown; remainingMinutes?: unknown; utilizationPercent?: unknown
  assignmentCount?: unknown; unknownAssignmentCount?: unknown; overlapCount?: unknown; reasons?: unknown
  calculatedAt?: unknown; periodEnd?: unknown
}

/**
 * `/v1/workload/query` returns `{ items, nextCursor }` — raw capacity_plan docs, not the WorkloadSnapshot
 * (period window, scope pick-list, aggregate summary, capability flags) this screen expects. Adapter maps
 * the real rows into a valid snapshot and computes the summary from them; a fresh org has no capacity
 * plans (they come from WorkloadProjectionService.rebuild), so this renders an empty projection until that
 * read path is built. capabilities fail closed (backend still enforces). Tracked as audit M1/M3.
 */
function toWorkloadSnapshot(raw: { items?: readonly RawCapacityRow[]; capabilities?: WorkloadSnapshot['capabilities'] }, scope: WorkloadScope, periodStart: string): WorkloadSnapshot {
  const rows: WorkloadRow[] = (raw.items ?? []).map((row) => ({
    userId: String(row.userId ?? ''), displayName: typeof row.displayName === 'string' ? row.displayName : '',
    status: (typeof row.status === 'string' ? row.status : 'known') as WorkloadRow['status'],
    scheduledMinutes: typeof row.scheduledMinutes === 'number' ? row.scheduledMinutes : null,
    absenceMinutes: typeof row.absenceMinutes === 'number' ? row.absenceMinutes : 0,
    availableMinutes: typeof row.availableMinutes === 'number' ? row.availableMinutes : null,
    allocatedMinutes: typeof row.allocatedMinutes === 'number' ? row.allocatedMinutes : 0,
    remainingMinutes: typeof row.remainingMinutes === 'number' ? row.remainingMinutes : null,
    utilizationPercent: typeof row.utilizationPercent === 'number' ? row.utilizationPercent : null,
    assignmentCount: typeof row.assignmentCount === 'number' ? row.assignmentCount : 0,
    unknownAssignmentCount: typeof row.unknownAssignmentCount === 'number' ? row.unknownAssignmentCount : 0,
    overlapCount: typeof row.overlapCount === 'number' ? row.overlapCount : 0,
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    calculatedAt: typeof row.calculatedAt === 'string' ? row.calculatedAt : '',
  }))
  const periodEnd = (raw.items ?? []).map((r) => (typeof r.periodEnd === 'string' ? r.periodEnd : '')).find(Boolean) ?? periodStart
  const summary = {
    knownPeople: rows.filter((r) => r.status !== 'unknown').length,
    unknownPeople: rows.filter((r) => r.status === 'unknown').length,
    overallocatedPeople: rows.filter((r) => r.remainingMinutes !== null && r.remainingMinutes < 0).length,
    totalAvailableMinutes: rows.reduce((s, r) => s + (r.availableMinutes ?? 0), 0),
    totalAllocatedMinutes: rows.reduce((s, r) => s + r.allocatedMinutes, 0),
  }
  return { periodStart, periodEnd, scope, availableScopes: [scope], rows, summary, capabilities: raw.capabilities ?? { viewEmployeeNames: false, rebuild: false } }
}

export const workloadClient: WorkloadClient = {
  load: async (organizationId, scope, periodStart) =>
    toWorkloadSnapshot(await post('/v1/workload/query', {
      organizationId, scopeType: scope.type, scopeId: scope.id, periodStart, limit: 50,
    }), scope, periodStart),
  rebuild: (organizationId, scope, periodStart, periodEnd) =>
    post('/v1/workload/rebuild', {
      organizationId, scopeType: scope.type, scopeId: scope.id, periodStart, periodEnd,
    }),
}

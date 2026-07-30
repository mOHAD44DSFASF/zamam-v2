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
export const workloadClient: WorkloadClient = {
  load: (organizationId, scope, periodStart) =>
    post('/v1/workload/query', {
      organizationId, scopeType: scope.type, scopeId: scope.id, periodStart, limit: 50,
    }),
  rebuild: (organizationId, scope, periodStart, periodEnd) =>
    post('/v1/workload/rebuild', {
      organizationId, scopeType: scope.type, scopeId: scope.id, periodStart, periodEnd,
    }),
}

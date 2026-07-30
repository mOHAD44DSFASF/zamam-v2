import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { calculateMetric } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import { ReportingService, type ReportingGate, type ReportingMetadata } from '../services/functions/src'
import { ReportExportHandler, buildCsv } from '../services/workers/src'
class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    const transaction: AtomicTransaction = { get: async (path) => working.get(path) ?? null, create: (path, data) => { if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, { ...data }) }, update: (path, data) => { const current = working.get(path); if (!current) throw new Error('NOT_FOUND'); working.set(path, { ...current, ...data }) } }
    const result = await operation(transaction); this.records = working; return result
  }
}
class Gate implements ReportingGate { requests: AuthorizationRequest[] = []; async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) } }
const principal: AuthorizationPrincipal = { userId: 'manager-1', authenticated: true, tokenFresh: true, accountStatus: 'active', employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active', principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true }
let sequence = 0
const metadata = (): ReportingMetadata => ({ organizationId: 'org-1', principal, correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}` })
const source = { completedCount: 4, onTimeCount: 3, cycleMinutesTotal: 1_000, reviewMinutesTotal: 300, reviewCount: 3, delayMinutes: { assignee: 60, reviewer: 120, client: 240, dependency: 90, system: 30, unattributed: 10 } }
describe('metric formulas and lineage', () => {
  it('computes fixed formulas and excludes attributed waiting from employee delay', () => {
    expect(calculateMetric('on_time_rate', source)).toBe(75)
    expect(calculateMetric('average_cycle_minutes', source)).toBe(250)
    expect(calculateMetric('review_turnaround_minutes', source)).toBe(100)
    expect(calculateMetric('accountable_delay_minutes', source)).toBe(70)
  })
  it('returns no data rather than zero for an empty denominator', () => {
    expect(calculateMetric('on_time_rate', { ...source, completedCount: 0, onTimeCount: 0 })).toBeNull()
  })
  it('reproduces the same measurement for the same definition, cutoff, and source hash', async () => {
    const store = new MemoryStore(); const gate = new Gate()
    const definition = { status: 'published', formulaKey: 'on_time_rate', definitionVersion: 2, visibility: 'performance_sensitive' }
    const service = new ReportingService(store, gate, { getDefinition: async () => definition }, { snapshot: async () => ({ ...source, sourceHash: 'a'.repeat(64), sourceRunId: 'run-1' }) }, { allowedFields: async () => ['metric', 'value'] }, { now: () => '2026-08-10T12:00:00.000Z' })
    const input = { definitionId: 'definition-1', subjectType: 'team' as const, subjectId: 'team-1', periodStart: '2026-08-01', periodEnd: '2026-08-07', cutoffAt: '2026-08-08T00:00:00.000Z' }
    const first = await service.calculate(metadata(), input)
    const second = await service.calculate(metadata(), input)
    expect(second).toEqual({ ...first, replayed: true })
    expect([...store.records.values()].filter((record) => record.kpiDefinitionId === 'definition-1')).toHaveLength(1)
    expect(gate.requests.at(-1)?.permission).toBe('performance.sensitive.view')
  })
})
describe('scoped asynchronous exports', () => {
  it('requires step-up and rejects unauthorized fields before creating a job', async () => {
    const store = new MemoryStore(); const gate = new Gate()
    const service = new ReportingService(store, gate, { getDefinition: async () => null }, { snapshot: vi.fn() }, { allowedFields: async () => ['metric', 'value'] }, { now: () => '2026-08-10T12:00:00.000Z' })
    await expect(service.requestExport(metadata(), { id: 'export-1', reportType: 'performance', scopeType: 'team', scopeId: 'team-1', format: 'csv', requestedFields: ['metric', 'salary'] })).rejects.toThrow('REPORT_EXPORT_FIELD_DENIED')
    expect(gate.requests.at(-1)).toMatchObject({ permission: 'report.export', requireStepUp: true })
    expect([...store.records.values()].some((record) => record.reportType === 'performance')).toBe(false)
  })
  it('builds bounded CSV and neutralizes spreadsheet formulas', () => {
    const csv = buildCsv(['name', 'value'], [{ name: '=CMD()', value: 10 }])
    expect(csv).toContain('"\'=CMD()"')
    expect(() => buildCsv(['x'], Array.from({ length: 10_001 }, () => ({ x: 1 })))).toThrow('EXPORT_ROW_LIMIT_EXCEEDED')
  })
  it('hands a minimized export event to the worker and completes through a port', async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    const handler = new ReportExportHandler({ rows: async () => [{ metric: 'on_time_rate', value: 75 }], complete })
    await handler.handle({ id: 'event-1', organizationId: 'org-1', payload: { exportJobId: 'export-1', reportType: 'operations', scopeType: 'team', scopeId: 'team-1', fields: ['metric', 'value'] } })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', exportJobId: 'export-1', rowCount: 1, sourceEventId: 'event-1' }))
  })
})

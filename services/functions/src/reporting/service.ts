import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { calculateMetric, SCHEMA_VERSION, type MetricKey, type MetricSourceSnapshot } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type PageQuery, type StoredDocument } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'
const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const definitionSchema = z.object({ id, key: z.enum(['on_time_rate', 'average_cycle_minutes', 'review_turnaround_minutes', 'accountable_delay_minutes']), name: z.string().trim().min(2).max(120), definitionVersion: z.number().int().positive(), unit: z.enum(['percent', 'minutes']), direction: z.enum(['higher_better', 'lower_better', 'neutral']), visibility: z.enum(['operational', 'performance_sensitive']) }).strict()
const calculationSchema = z.object({ definitionId: id, subjectType: z.enum(['organization', 'department', 'team', 'user', 'project']), subjectId: id, periodStart: date, periodEnd: date, cutoffAt: z.string().datetime() }).strict()
const exportSchema = z.object({ id, reportType: z.enum(['operations', 'workload', 'time', 'attendance', 'performance']), scopeType: z.enum(['self', 'team', 'department', 'organization', 'project']), scopeId: id, format: z.literal('csv'), requestedFields: z.array(z.string().min(1).max(80)).min(1).max(30) }).strict()
export interface ReportingGate { require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown> }
export interface ReportingLookup { getDefinition(organizationId: string, definitionId: string): Promise<StoredDocument | null> }
export interface MetricSourcePort { snapshot(input: { organizationId: string; subjectType: string; subjectId: string; periodStart: string; periodEnd: string; cutoffAt: string }): Promise<MetricSourceSnapshot & { sourceHash: string; sourceRunId: string }> }
export interface ExportProjectionPolicy { allowedFields(principal: AuthorizationPrincipal, reportType: string, scopeType: string, scopeId: string): Promise<readonly string[]> }
export interface ReportingMetadata { organizationId: string; principal: AuthorizationPrincipal; correlationId: string; idempotencyKey: string; fingerprint: string }
export interface ReportingClock { now(): string }
const base = (organizationId: string) => ({ organizationId, schemaVersion: SCHEMA_VERSION, version: 1, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP })
const resource = (organizationId: string, type: string, idValue: string) => ({ type, id: idValue, organizationId, visibility: 'restricted' as const })
const measurementId = (...values: string[]) => `measurement-${createHash('sha256').update(values.join(':')).digest('hex').slice(0, 40)}`
export function buildMeasurementQuery(input: { organizationId: string; subjectType: string; subjectId: string; periodStart: string; limit?: number; cursor?: readonly unknown[] }): PageQuery {
  id.parse(input.organizationId); id.parse(input.subjectId); date.parse(input.periodStart)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return { organizationId: input.organizationId, entityKind: 'kpi_measurement', filters: [{ field: 'subjectType', operator: '==', value: input.subjectType }, { field: 'subjectId', operator: '==', value: input.subjectId }, { field: 'periodStart', operator: '==', value: input.periodStart }], orderBy: [{ field: 'calculatedAt', direction: 'desc' }], limit, ...(input.cursor ? { cursor: input.cursor } : {}) }
}
export class ReportingService {
  private readonly audit: AuditCommandService
  constructor(private readonly store: AtomicStore, private readonly gate: ReportingGate, private readonly lookup: ReportingLookup, private readonly metrics: MetricSourcePort, private readonly exports: ExportProjectionPolicy, private readonly clock: ReportingClock, audit?: AuditCommandService) { this.audit = audit ?? new AuditCommandService(store) }
  private async context(metadata: ReportingMetadata, permission: 'kpi.manage' | 'report.export', type: string, resourceId: string) {
    await this.gate.require(metadata.principal, { permission, organizationId: metadata.organizationId, resource: resource(metadata.organizationId, type, resourceId), requireStepUp: permission === 'report.export' })
    return { organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission, correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint, resourceId }
  }
  async publishDefinition(metadata: ReportingMetadata, raw: z.input<typeof definitionSchema>) {
    const input = definitionSchema.parse(raw); const context = await this.context(metadata, 'kpi.manage', 'kpi_definition', input.id)
    return this.audit.execute(context, async (transaction) => {
      transaction.create(tenantDocumentPath(metadata.organizationId, 'kpi_definition', input.id), { ...base(metadata.organizationId), ...input, formulaKey: input.key, status: 'published', publishedAt: SERVER_TIMESTAMP })
      return { result: { definitionId: input.id, version: 1 }, resourceType: 'kpi_definition', resourceId: input.id, outbox: { type: 'kpi.definition_published', version: 1, payload: { definitionId: input.id, definitionVersion: input.definitionVersion } } }
    })
  }
  async calculate(metadata: ReportingMetadata, raw: z.input<typeof calculationSchema>) {
    const input = calculationSchema.parse(raw)
    if (input.periodEnd < input.periodStart || Date.parse(input.cutoffAt) > Date.parse(this.clock.now())) throw new Error('METRIC_PERIOD_INVALID')
    const definition = await this.lookup.getDefinition(metadata.organizationId, input.definitionId)
    if (!definition || definition.status !== 'published') throw new Error('KPI_DEFINITION_NOT_PUBLISHED')
    const permission = definition.visibility === 'performance_sensitive' ? 'performance.sensitive.view' : 'report.view_organization'
    await this.gate.require(metadata.principal, { permission, organizationId: metadata.organizationId, resource: resource(metadata.organizationId, input.subjectType, input.subjectId) })
    const snapshot = await this.metrics.snapshot({ organizationId: metadata.organizationId, subjectType: input.subjectType, subjectId: input.subjectId, periodStart: input.periodStart, periodEnd: input.periodEnd, cutoffAt: input.cutoffAt })
    if (!/^[a-f0-9]{64}$/.test(snapshot.sourceHash)) throw new Error('METRIC_SOURCE_HASH_INVALID')
    const value = calculateMetric(String(definition.formulaKey) as MetricKey, snapshot)
    const resultId = measurementId(input.definitionId, String(definition.definitionVersion), input.subjectType, input.subjectId, input.periodStart, input.periodEnd, input.cutoffAt, snapshot.sourceHash)
    return this.store.runTransaction(async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'kpi_measurement', resultId)
      if (await transaction.get(path)) return { measurementId: resultId, value, replayed: true }
      transaction.create(path, { ...base(metadata.organizationId), kpiDefinitionId: input.definitionId, definitionVersion: Number(definition.definitionVersion), subjectType: input.subjectType, subjectId: input.subjectId, periodStart: input.periodStart, periodEnd: input.periodEnd, cutoffAt: input.cutoffAt, ...(value === null ? {} : { value }), status: value === null ? 'no_data' : 'complete', sourceHash: snapshot.sourceHash, sourceRunId: snapshot.sourceRunId, calculatedAt: SERVER_TIMESTAMP })
      return { measurementId: resultId, value, replayed: false }
    })
  }
  async requestExport(metadata: ReportingMetadata, raw: z.input<typeof exportSchema>) {
    const input = exportSchema.parse(raw); const context = await this.context(metadata, 'report.export', input.scopeType, input.scopeId)
    const allowed = new Set(await this.exports.allowedFields(metadata.principal, input.reportType, input.scopeType, input.scopeId))
    if (input.requestedFields.some((field) => !allowed.has(field))) throw new Error('REPORT_EXPORT_FIELD_DENIED')
    const expiresAt = new Date(Date.parse(this.clock.now()) + 24 * 60 * 60 * 1_000).toISOString()
    return this.audit.execute(context, async (transaction) => {
      transaction.create(tenantDocumentPath(metadata.organizationId, 'export_job', input.id), { ...base(metadata.organizationId), requestedBy: metadata.principal.userId, reportType: input.reportType, scopeType: input.scopeType, scopeId: input.scopeId, format: input.format, fields: input.requestedFields, status: 'queued', expiresAt })
      return { result: { exportJobId: input.id, status: 'queued' as const, expiresAt }, resourceType: 'export_job', resourceId: input.id, outbox: { type: 'report.export_requested', version: 1, payload: { exportJobId: input.id, reportType: input.reportType, scopeType: input.scopeType, scopeId: input.scopeId, fields: input.requestedFields } } }
    })
  }
}

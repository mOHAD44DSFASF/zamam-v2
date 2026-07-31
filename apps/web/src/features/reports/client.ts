import { appCheckHeaders, auth } from '../../lib/firebase'
export interface ReportSnapshot { periodStart: string; periodEnd: string; metrics: readonly { id: string; name: string; value: number | null; unit: 'percent'|'minutes'; definitionVersion: number; cutoffAt: string; status: 'complete'|'no_data'; visibility: 'operational'|'performance_sensitive' }[]; exportJobs: readonly { id: string; status: string; expiresAt: string; downloadUrl: string | null }[]; capabilities: { export: boolean; viewPerformance: boolean; viewFinancial: boolean }; allowedExportFields: readonly { key: string; label: string }[] }
export interface ReportClient { load(organizationId: string, periodStart: string): Promise<ReportSnapshot>; requestExport(organizationId: string, input: { id: string; reportType: 'operations'|'performance'; scopeType: 'organization'; scopeId: string; format: 'csv'; requestedFields: readonly string[] }): Promise<void> }
async function post<T>(path: string, body: unknown): Promise<T> { const baseUrl = import.meta.env.VITE_API_BASE_URL; const user = auth.currentUser; if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED'); const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(), ...await appCheckHeaders() }, body: JSON.stringify(body) }); const envelope = await response.json() as { data?: T; error?: { code: string } }; if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'REPORT_REQUEST_FAILED'); return envelope.data }
interface RawMeasurement { id?: unknown; name?: unknown; value?: unknown; unit?: unknown; definitionVersion?: unknown; cutoffAt?: unknown; status?: unknown; visibility?: unknown }

/**
 * `/v1/reports/query` requires subjectType/subjectId (audit B3 400 root cause — the page sent neither)
 * and returns `{ items, nextCursor }` (kpi_measurement docs), not the ReportSnapshot (export jobs,
 * capability flags, allowed export fields) this screen expects. Adapter defaults the subject to the
 * organization scope, maps the real measurements into metrics, and returns empty export jobs / fields
 * with fail-closed capabilities (backend still enforces). Tracked as audit M1/M2.
 */
function toReportSnapshot(raw: { items?: readonly RawMeasurement[]; capabilities?: ReportSnapshot['capabilities'] }, periodStart: string): ReportSnapshot {
  const metrics = (raw.items ?? []).map((row) => ({
    id: String(row.id ?? ''), name: typeof row.name === 'string' ? row.name : '',
    value: typeof row.value === 'number' ? row.value : null,
    unit: (row.unit === 'minutes' ? 'minutes' : 'percent') as 'percent' | 'minutes',
    definitionVersion: typeof row.definitionVersion === 'number' ? row.definitionVersion : 1,
    cutoffAt: typeof row.cutoffAt === 'string' ? row.cutoffAt : '',
    status: (row.status === 'complete' ? 'complete' : 'no_data') as 'complete' | 'no_data',
    visibility: (row.visibility === 'performance_sensitive' ? 'performance_sensitive' : 'operational') as 'operational' | 'performance_sensitive',
  }))
  return { periodStart, periodEnd: periodStart, metrics, exportJobs: [], capabilities: raw.capabilities ?? { export: false, viewPerformance: false, viewFinancial: false }, allowedExportFields: [] }
}
export const reportClient: ReportClient = { load: async (organizationId, periodStart) => toReportSnapshot(await post('/v1/reports/query', { organizationId, subjectType: 'organization', subjectId: organizationId, periodStart, limit: 50 }), periodStart), requestExport: (organizationId, input) => post('/v1/reports/export', { organizationId, ...input }) }

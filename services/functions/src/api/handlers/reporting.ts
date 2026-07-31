import {
  ReportingService, buildMeasurementQuery,
  type ExportProjectionPolicy, type MetricSourcePort, type ReportingClock, type ReportingLookup,
} from '../../reporting/service.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireString } from '../registry.js'

const lookup: ReportingLookup = { async getDefinition() { return null } }
const metrics: MetricSourcePort = { async snapshot() { throw new Error('METRIC_CALCULATION_NOT_CONFIGURED') } }
const clock: ReportingClock = { now: () => new Date().toISOString() }

// v1 simplification: a static, conservative per-report field allowlist; no per-organization field catalog yet.
const REPORT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  operations: ['id', 'title', 'status', 'priority', 'dueAt', 'projectId'],
  workload: ['userId', 'periodStart', 'periodEnd', 'utilizationPercent', 'status'],
  time: ['userId', 'projectId', 'localDate', 'minutes', 'billable'],
  attendance: ['userId', 'date', 'status', 'workedMinutes'],
  performance: ['subjectType', 'subjectId', 'periodStart', 'periodEnd', 'value'],
}
const exportsPolicy: ExportProjectionPolicy = {
  async allowedFields(_principal, reportType) { return REPORT_FIELDS[reportType] ?? [] },
}

export function createReportingHandlers(deps: Deps): HandlerRegistry {
  const service = new ReportingService(deps.store, deps.authorization, lookup, metrics, exportsPolicy, clock)

  return {
    '/v1/reports/query': async (context, input) => {
      const subjectType = requireString(input, 'subjectType')
      const subjectId = requireString(input, 'subjectId')
      await deps.authorization.require(context.principal, {
        permission: 'report.view_organization', organizationId: context.organizationId,
        resource: { type: subjectType, id: subjectId, organizationId: context.organizationId, visibility: 'restricted' },
      })
      const query = buildMeasurementQuery({
        organizationId: context.organizationId, subjectType, subjectId, periodStart: requireString(input, 'periodStart'),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/kpi_measurement`, query)
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        export: 'report.export', viewPerformance: 'performance.sensitive.view', viewFinancial: 'project.financial.view',
      })
      return { items: page.items, nextCursor: page.nextCursor, capabilities }
    },
    '/v1/reports/export': (context, input) => service.requestExport({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, {
      id: requireString(input, 'id'), reportType: requireString(input, 'reportType') as 'operations' | 'workload' | 'time' | 'attendance' | 'performance',
      scopeType: requireString(input, 'scopeType') as 'self' | 'team' | 'department' | 'organization' | 'project',
      scopeId: requireString(input, 'scopeId'), format: 'csv',
      requestedFields: Array.isArray(input.requestedFields) ? input.requestedFields.filter((v): v is string => typeof v === 'string') : [],
    }),
  }
}

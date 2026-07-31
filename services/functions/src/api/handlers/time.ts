import { tenantDocumentPath } from '@zamam/firestore'
import { TimeTrackingService, buildTimeEntryQuery, type TimeClock, type TimeLookupPort } from '../../time/service.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createLookupPort(deps: Deps): TimeLookupPort {
  return {
    async findRunning(organizationId, userId) {
      const page = await listQuery(deps, organizationId, 'time_entry', {
        filters: [{ field: 'userId', operator: '==', value: userId }, { field: 'timerState', operator: '==', value: 'running' }],
        orderBy: [{ field: 'startedAt', direction: 'desc' }], limit: 1,
      })
      return page.items[0] ?? null
    },
    getEntry: (organizationId, entryId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'time_entry', entryId)),
    getTimesheet: (organizationId, timesheetId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'timesheet', timesheetId)),
    getCorrection: (organizationId, correctionId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'time_correction', correctionId)),
    async listPeriodEntries(organizationId, userId, periodStart, periodEnd) {
      const page = await listQuery(deps, organizationId, 'time_entry', {
        filters: [
          { field: 'userId', operator: '==', value: userId },
          { field: 'localDate', operator: '>=', value: periodStart },
          { field: 'localDate', operator: '<=', value: periodEnd },
        ],
        orderBy: [{ field: 'localDate', direction: 'asc' }], limit: 100,
      })
      return page.items
    },
    async hasOverlap(organizationId, userId, startedAt, endedAt, excludeEntryId) {
      const page = await listQuery(deps, organizationId, 'time_entry', {
        filters: [{ field: 'userId', operator: '==', value: userId }],
        orderBy: [{ field: 'startedAt', direction: 'desc' }], limit: 50,
      })
      return page.items.some((entry) => {
        if (entry.id === excludeEntryId || typeof entry.endedAt !== 'string') return false
        return String(entry.startedAt) < endedAt && String(entry.endedAt) > startedAt
      })
    },
  }
}

const clock: TimeClock = { now: () => new Date().toISOString() }

export function createTimeHandlers(deps: Deps): HandlerRegistry {
  const service = new TimeTrackingService(deps.store, deps.authorization, createLookupPort(deps), clock)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.startTimer>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/time/query': async (context, input) => {
      const userId = typeof input.userId === 'string' ? input.userId : context.principal.userId
      await deps.authorization.require(context.principal, {
        permission: userId === context.principal.userId ? 'time.view_self' : 'time.view_team',
        organizationId: context.organizationId,
        resource: { type: 'user', id: userId, organizationId: context.organizationId, ownerUserId: userId, visibility: 'restricted' },
      })
      const query = buildTimeEntryQuery({
        organizationId: context.organizationId, userId,
        periodStart: requireString(input, 'periodStart'), periodEnd: requireString(input, 'periodEnd'),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/time_entry`, query)
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        track: 'time.track', submit: 'timesheet.submit', approve: 'timesheet.approve',
        viewBillable: 'time.view_team', requestCorrection: 'time.adjust',
      })
      return { items: page.items, nextCursor: page.nextCursor, capabilities }
    },
    '/v1/time/timer/start': (context, input) => service.startTimer(metadata(context), {
      id: requireString(input, 'id'), projectId: requireString(input, 'projectId'),
      billable: typeof input.billable === 'boolean' ? input.billable : false, timezone: requireString(input, 'timezone'),
      ...(typeof input.taskId === 'string' ? { taskId: input.taskId } : {}),
      ...(typeof input.note === 'string' ? { note: input.note } : {}),
    }),
    '/v1/time/timer/stop': (context, input) => service.stopTimer(
      metadata(context), requireString(input, 'entryId'), requireNumber(input, 'expectedVersion'),
    ),
    '/v1/time/entries/create': (context, input) => service.createManual(metadata(context), {
      id: requireString(input, 'id'), projectId: requireString(input, 'projectId'),
      startedAt: requireString(input, 'startedAt'), endedAt: requireString(input, 'endedAt'),
      billable: typeof input.billable === 'boolean' ? input.billable : false, timezone: requireString(input, 'timezone'),
      ...(typeof input.taskId === 'string' ? { taskId: input.taskId } : {}),
      ...(typeof input.note === 'string' ? { note: input.note } : {}),
    }),
    '/v1/timesheets/submit': (context, input) => service.submitTimesheet(
      metadata(context), requireString(input, 'periodStart'), requireString(input, 'periodEnd'),
    ),
    '/v1/timesheets/decide': (context, input) => service.decideTimesheet(metadata(context), requireString(input, 'timesheetId'), {
      expectedVersion: requireNumber(input, 'expectedVersion'), decision: requireString(input, 'decision') as 'approved' | 'rejected',
      ...(typeof input.reason === 'string' ? { reason: input.reason } : {}),
    }),
  }
}

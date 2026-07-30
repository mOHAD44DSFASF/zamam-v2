import { tenantDocumentPath } from '@zamam/firestore'
import { AttendanceService, type AttendanceLookup } from '../../attendance/service.js'
import { LeaveService, type LeaveApproverResolver, type LeaveLookup } from '../../leave/service.js'
import type { Deps } from '../deps.js'
import { listQuery, orgPath, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createAttendanceLookup(deps: Deps): AttendanceLookup {
  return { get: (organizationId, recordId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'attendance_record', recordId)) }
}

function createLeaveLookup(deps: Deps): LeaveLookup {
  return {
    getRequest: (organizationId, requestId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'leave_request', requestId)),
    getBalance: (organizationId, balanceId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'leave_balance', balanceId)),
    async hasOverlap(organizationId, userId, startsOn, endsOn) {
      const page = await listQuery(deps, organizationId, 'leave_request', {
        filters: [{ field: 'userId', operator: '==', value: userId }, { field: 'status', operator: 'in', value: ['submitted', 'approved'] }],
        orderBy: [{ field: 'startsOn', direction: 'desc' }], limit: 50,
      })
      return page.items.some((entry) => String(entry.startsOn) <= endsOn && String(entry.endsOn) >= startsOn)
    },
  }
}

// v1 simplification: a single required approver (the employee's direct manager); no escalation by leave duration yet.
function createApproverResolver(deps: Deps): LeaveApproverResolver {
  return {
    async resolve(organizationId, userId) {
      const employment = await readDoc(deps.firestore, orgPath(organizationId, 'employment_profile', userId))
      const managerUserId = employment && typeof employment.managerUserId === 'string' ? employment.managerUserId : null
      return managerUserId ? [managerUserId] : []
    },
  }
}

export function createAttendanceLeaveHandlers(deps: Deps): HandlerRegistry {
  const attendance = new AttendanceService(deps.store, deps.authorization, createAttendanceLookup(deps))
  const leave = new LeaveService(deps.store, deps.authorization, createLeaveLookup(deps), createApproverResolver(deps))
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof leave.request>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/attendance/overview': async (context, input) => {
      const userId = typeof input.userId === 'string' ? input.userId : context.principal.userId
      await deps.authorization.require(context.principal, {
        permission: userId === context.principal.userId ? 'attendance.view_self' : 'attendance.view_team',
        organizationId: context.organizationId,
        resource: { type: 'user', id: userId, organizationId: context.organizationId, ownerUserId: userId, visibility: 'restricted' },
      })
      const periodStart = requireString(input, 'periodStart')
      const periodEnd = requireString(input, 'periodEnd')
      const page = await listQuery(deps, context.organizationId, 'attendance_record', {
        filters: [
          { field: 'userId', operator: '==', value: userId },
          { field: 'date', operator: '>=', value: periodStart }, { field: 'date', operator: '<=', value: periodEnd },
        ],
        orderBy: [{ field: 'date', direction: 'desc' }], limit: 100,
      })
      return { items: page.items }
    },
    '/v1/attendance/record': (context, input) => attendance.record(metadata(context), {
      userId: requireString(input, 'userId'), workDate: requireString(input, 'workDate'),
      scheduledMinutes: requireNumber(input, 'scheduledMinutes'),
      holiday: typeof input.holiday === 'boolean' ? input.holiday : false,
      approvedLeave: typeof input.approvedLeave === 'boolean' ? input.approvedLeave : false,
      ...(typeof input.checkInAt === 'string' ? { checkInAt: input.checkInAt } : {}),
      ...(typeof input.checkOutAt === 'string' ? { checkOutAt: input.checkOutAt } : {}),
      ...(typeof input.scheduledStartAt === 'string' ? { scheduledStartAt: input.scheduledStartAt } : {}),
    }),
    '/v1/leave/request': (context, input) => leave.request(metadata(context), {
      id: requireString(input, 'id'), leaveTypeId: requireString(input, 'leaveTypeId'),
      startsOn: requireString(input, 'startsOn'), endsOn: requireString(input, 'endsOn'), reason: requireString(input, 'reason'),
    }),
    '/v1/leave/decide': (context, input) => leave.decide(
      metadata(context), requireString(input, 'requestId'), requireNumber(input, 'expectedVersion'),
      requireString(input, 'decision') as 'approved' | 'rejected',
      typeof input.reason === 'string' ? input.reason : undefined,
    ),
  }
}

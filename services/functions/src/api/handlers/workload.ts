import { WorkloadProjectionService, buildWorkloadQuery, workloadViewPermission, type WorkloadMember, type WorkloadSourcePort } from '../../workload/service.js'
import type { Deps } from '../deps.js'
import { listQuery, readDoc } from '../deps.js'
import { orgPath } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireString } from '../registry.js'

// v1 simplification: absence/scheduled minutes derived from work_schedule.weeklyMinutes and a flat 8h/day
// leave conversion; no per-day shift calendar yet.
const MINUTES_PER_DAY = 480

function overlapsPeriod(start: string, end: string, periodStart: string, periodEnd: string) {
  return start <= periodEnd && end >= periodStart
}

function createSourcePort(deps: Deps): WorkloadSourcePort {
  return {
    async listMembers(organizationId, scopeType, scopeId): Promise<readonly WorkloadMember[]> {
      if (scopeType === 'team') {
        const page = await listQuery(deps, organizationId, 'team_membership', {
          filters: [{ field: 'teamId', operator: '==', value: scopeId }, { field: 'status', operator: '==', value: 'active' }],
          orderBy: [{ field: 'userId', direction: 'asc' }], limit: 100,
        })
        return Promise.all(page.items.map(async (item) => ({
          userId: String(item.userId), teamId: scopeId,
          displayName: await displayName(deps, organizationId, String(item.userId)),
        })))
      }
      const page = await listQuery(deps, organizationId, 'employment_profile', {
        filters: [
          { field: 'status', operator: '==', value: 'active' },
          ...(scopeType === 'department' ? [{ field: 'primaryDepartmentId', operator: '==' as const, value: scopeId }] : []),
        ],
        orderBy: [{ field: 'userId', direction: 'asc' }], limit: 100,
      })
      return Promise.all(page.items.map(async (item) => ({
        userId: String(item.userId), departmentId: String(item.primaryDepartmentId),
        displayName: await displayName(deps, organizationId, String(item.userId)),
      })))
    },
    async scheduledMinutes(organizationId, userId, periodStart, periodEnd) {
      const schedule = await readDoc(deps.firestore, orgPath(organizationId, 'work_schedule', userId))
      if (!schedule || typeof schedule.weeklyMinutes !== 'number') return null
      const days = Math.max(1, (Date.parse(periodEnd) - Date.parse(periodStart)) / 86_400_000 + 1)
      return Math.round((Number(schedule.weeklyMinutes) / 7) * days)
    },
    async approvedAbsenceMinutes(organizationId, userId, periodStart, periodEnd) {
      const [leaves, holidays] = await Promise.all([
        listQuery(deps, organizationId, 'leave_request', {
          filters: [{ field: 'userId', operator: '==', value: userId }, { field: 'status', operator: '==', value: 'approved' }],
          orderBy: [{ field: 'startsOn', direction: 'asc' }], limit: 50,
        }),
        listQuery(deps, organizationId, 'holiday', { orderBy: [{ field: 'date', direction: 'asc' }], limit: 50 }),
      ])
      const leaveMinutes = leaves.items
        .filter((leave) => overlapsPeriod(String(leave.startsOn), String(leave.endsOn), periodStart, periodEnd))
        .reduce((sum, leave) => {
          const start = String(leave.startsOn) < periodStart ? periodStart : String(leave.startsOn)
          const end = String(leave.endsOn) > periodEnd ? periodEnd : String(leave.endsOn)
          const days = Math.max(1, (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1)
          return sum + days * MINUTES_PER_DAY
        }, 0)
      const holidayMinutes = holidays.items
        .filter((holiday) => String(holiday.date) >= periodStart && String(holiday.date) <= periodEnd)
        .length * MINUTES_PER_DAY
      return { leaveMinutes, holidayMinutes }
    },
    async assignments(organizationId, userId, periodStart, periodEnd) {
      const page = await listQuery(deps, organizationId, 'task_assignment', {
        filters: [{ field: 'userId', operator: '==', value: userId }, { field: 'status', operator: '==', value: 'accepted' }],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
      })
      void periodStart; void periodEnd
      return page.items.map((item) => ({ id: String(item.id), estimatedMinutes: null }))
    },
  }
}

async function displayName(deps: Deps, organizationId: string, userId: string) {
  const profile = await readDoc(deps.firestore, orgPath(organizationId, 'user_profile', userId))
  return profile ? String(profile.displayName) : userId
}

export function createWorkloadHandlers(deps: Deps): HandlerRegistry {
  const service = new WorkloadProjectionService(deps.store, deps.authorization, createSourcePort(deps))

  return {
    '/v1/workload/query': async (context, input) => {
      const scopeType = requireString(input, 'scopeType') as 'organization' | 'department' | 'team'
      const scopeId = requireString(input, 'scopeId')
      const periodStart = requireString(input, 'periodStart')
      await deps.authorization.require(context.principal, {
        permission: workloadViewPermission(scopeType === 'organization' ? 'organization' : scopeType),
        organizationId: context.organizationId,
        resource: {
          type: scopeType, id: scopeId, organizationId: context.organizationId,
          ...(scopeType === 'team' ? { teamId: scopeId } : {}), ...(scopeType === 'department' ? { departmentId: scopeId } : {}),
          visibility: 'restricted',
        },
      })
      const query = buildWorkloadQuery({
        organizationId: context.organizationId, scopeType, scopeId, periodStart,
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/capacity_plan`, query)
      return { items: page.items, nextCursor: page.nextCursor }
    },
    '/v1/workload/rebuild': (context, input) => service.rebuild({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, {
      periodStart: requireString(input, 'periodStart'), periodEnd: requireString(input, 'periodEnd'),
      scopeType: requireString(input, 'scopeType') as 'organization' | 'department' | 'team',
      scopeId: requireString(input, 'scopeId'),
    }),
  }
}

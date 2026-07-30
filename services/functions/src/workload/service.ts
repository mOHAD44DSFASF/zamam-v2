import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import {
  calculateWorkload, SCHEMA_VERSION, type WorkloadAssignmentInput,
} from '@zamam/domain'
import {
  SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type PageQuery,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const rebuildSchema = z.object({
  periodStart: date, periodEnd: date,
  scopeType: z.enum(['organization', 'department', 'team']),
  scopeId: id,
}).strict()
export interface WorkloadMember {
  userId: string
  displayName: string
  teamId?: string
  departmentId?: string
}
export interface WorkloadSourcePort {
  listMembers(
    organizationId: string, scopeType: 'organization' | 'department' | 'team',
    scopeId: string,
  ): Promise<readonly WorkloadMember[]>
  scheduledMinutes(
    organizationId: string, userId: string, periodStart: string, periodEnd: string,
  ): Promise<number | null>
  approvedAbsenceMinutes(
    organizationId: string, userId: string, periodStart: string, periodEnd: string,
  ): Promise<{ leaveMinutes: number; holidayMinutes: number }>
  assignments(
    organizationId: string, userId: string, periodStart: string, periodEnd: string,
  ): Promise<readonly WorkloadAssignmentInput[]>
}
export interface WorkloadAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface WorkloadMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
const recordId = (periodStart: string, userId: string) =>
  `capacity-${periodStart.replaceAll('-', '')}-${userId}`
const scopeResource = (
  organizationId: string, scopeType: 'organization' | 'department' | 'team',
  scopeId: string,
) => ({
  type: scopeType, id: scopeId, organizationId,
  ...(scopeType === 'team' ? { teamId: scopeId } : {}),
  ...(scopeType === 'department' ? { departmentId: scopeId } : {}),
  visibility: 'restricted' as const,
})
export function workloadViewPermission(
  scopeType: 'self' | 'team' | 'department' | 'organization',
) {
  if (scopeType === 'self') return 'workload.view_self' as const
  if (scopeType === 'team') return 'workload.view_team' as const
  return 'workload.view_organization' as const
}
export function buildWorkloadQuery(input: {
  organizationId: string
  scopeType: 'organization' | 'department' | 'team'
  scopeId: string
  periodStart: string
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); id.parse(input.scopeId); date.parse(input.periodStart)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'capacity_plan',
    filters: [
      { field: 'scopeType', operator: '==', value: input.scopeType },
      { field: 'scopeId', operator: '==', value: input.scopeId },
      { field: 'periodStart', operator: '==', value: input.periodStart },
    ],
    orderBy: [
      { field: 'utilizationPercent', direction: 'desc' },
      { field: 'userId', direction: 'asc' },
    ],
    limit, ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class WorkloadProjectionService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: WorkloadAuthorizationGate,
    private readonly source: WorkloadSourcePort,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  async rebuild(metadata: WorkloadMetadata, raw: z.input<typeof rebuildSchema>) {
    const input = rebuildSchema.parse(raw)
    if (input.periodEnd < input.periodStart) throw new Error('WORKLOAD_PERIOD_INVALID')
    await this.authorization.require(metadata.principal, {
      permission: 'workload.manage', organizationId: metadata.organizationId,
      resource: scopeResource(
        metadata.organizationId, input.scopeType, input.scopeId,
      ),
    })
    const members = await this.source.listMembers(
      metadata.organizationId, input.scopeType, input.scopeId,
    )
    if (members.length > 100) throw new Error('WORKLOAD_REBUILD_TOO_LARGE')
    if (new Set(members.map(({ userId }) => userId)).size !== members.length) {
      throw new Error('WORKLOAD_MEMBER_DUPLICATE')
    }
    const projections = await Promise.all(members.map(async (member) => {
      id.parse(member.userId)
      const [scheduledMinutes, absence, assignments] = await Promise.all([
        this.source.scheduledMinutes(
          metadata.organizationId, member.userId, input.periodStart, input.periodEnd,
        ),
        this.source.approvedAbsenceMinutes(
          metadata.organizationId, member.userId, input.periodStart, input.periodEnd,
        ),
        this.source.assignments(
          metadata.organizationId, member.userId, input.periodStart, input.periodEnd,
        ),
      ])
      return {
        member,
        calculation: calculateWorkload({
          scheduledMinutes, approvedLeaveMinutes: absence.leaveMinutes,
          holidayMinutes: absence.holidayMinutes, assignments,
        }),
      }
    }))
    const context = {
      organizationId: metadata.organizationId,
      actorUserId: metadata.principal.userId,
      permission: 'workload.manage' as const,
      correlationId: metadata.correlationId,
      idempotencyKey: metadata.idempotencyKey,
      fingerprint: metadata.fingerprint,
    }
    return this.audit.execute(context, async (transaction) => {
      // Read phase — every capacity_plan doc is read before any write (Firestore transaction rule; the
      // loop previously read then update/create'd each plan in turn, so the second iteration's get()
      // followed the first iteration's write).
      const plans = await Promise.all(projections.map(async ({ member, calculation }) => {
        const path = tenantDocumentPath(metadata.organizationId, 'capacity_plan', recordId(input.periodStart, member.userId))
        const current = await transaction.get(path)
        const data = {
          organizationId: metadata.organizationId, schemaVersion: SCHEMA_VERSION,
          userId: member.userId, displayName: member.displayName,
          periodStart: input.periodStart, periodEnd: input.periodEnd,
          scopeType: input.scopeType, scopeId: input.scopeId,
          absenceMinutes: calculation.absenceMinutes,
          allocatedMinutes: calculation.allocatedMinutes,
          status: calculation.status, assignmentCount: calculation.assignmentCount,
          unknownAssignmentCount: calculation.unknownAssignmentCount,
          overlapCount: calculation.overlapCount, reasons: calculation.reasons,
          ...(calculation.scheduledMinutes === null
            ? {} : { scheduledMinutes: calculation.scheduledMinutes }),
          ...(calculation.availableMinutes === null
            ? {} : { availableMinutes: calculation.availableMinutes }),
          ...(calculation.remainingMinutes === null
            ? {} : { remainingMinutes: calculation.remainingMinutes }),
          ...(calculation.utilizationPercent === null
            ? {} : { utilizationPercent: calculation.utilizationPercent }),
          calculatedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        }
        return { path, current, data }
      }))
      // Write phase.
      for (const { path, current, data } of plans) {
        if (current) transaction.update(path, { ...data, version: Number(current.version) + 1 })
        else transaction.create(path, { ...data, version: 1, createdAt: SERVER_TIMESTAMP })
      }
      return {
        result: {
          periodStart: input.periodStart, periodEnd: input.periodEnd,
          count: projections.length,
          unknownCount: projections.filter(({ calculation }) =>
            calculation.status === 'unknown').length,
        },
        resourceType: 'capacity_plan',
        resourceId: `${input.scopeType}-${input.scopeId}-${input.periodStart}`,
        outbox: {
          type: 'workload.projection_rebuilt', version: 1,
          payload: {
            scopeType: input.scopeType, scopeId: input.scopeId,
            periodStart: input.periodStart, periodEnd: input.periodEnd,
            count: projections.length,
          },
        },
      }
    })
  }
}

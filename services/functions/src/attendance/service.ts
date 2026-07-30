import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { deriveAttendanceStatus, SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type StoredDocument } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const recordSchema = z.object({
  userId: id, workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledMinutes: z.number().int().min(0).max(1_440),
  checkInAt: z.string().datetime().optional(), checkOutAt: z.string().datetime().optional(),
  scheduledStartAt: z.string().datetime().optional(),
  holiday: z.boolean(), approvedLeave: z.boolean(),
}).strict()
export interface AttendanceGate { require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown> }
export interface AttendanceLookup { get(organizationId: string, recordId: string): Promise<StoredDocument | null> }
export interface AttendanceMetadata { organizationId: string; principal: AuthorizationPrincipal; correlationId: string; idempotencyKey: string; fingerprint: string }
const base = (organizationId: string) => ({ organizationId, schemaVersion: SCHEMA_VERSION, version: 1, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP })
const recordId = (userId: string, workDate: string) => `attendance-${workDate.replaceAll('-', '')}-${userId}`
export class AttendanceService {
  private readonly audit: AuditCommandService
  constructor(private readonly store: AtomicStore, private readonly gate: AttendanceGate, private readonly lookup: AttendanceLookup, audit?: AuditCommandService) {
    this.audit = audit ?? new AuditCommandService(store)
  }
  private async context(metadata: AttendanceMetadata, permission: 'attendance.record' | 'attendance.manage', userId: string, resourceId: string) {
    await this.gate.require(metadata.principal, { permission, organizationId: metadata.organizationId, resource: { type: 'user', id: userId, organizationId: metadata.organizationId, ownerUserId: userId, visibility: 'restricted' } })
    return { organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission, correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint, resourceId }
  }
  async record(metadata: AttendanceMetadata, raw: z.input<typeof recordSchema>) {
    const input = recordSchema.parse(raw)
    if (input.userId !== metadata.principal.userId) throw new Error('ATTENDANCE_SELF_ONLY')
    const idValue = recordId(input.userId, input.workDate)
    const result = deriveAttendanceStatus({
      scheduledMinutes: input.scheduledMinutes, holiday: input.holiday,
      approvedLeave: input.approvedLeave,
      ...(input.checkInAt ? { checkInAt: input.checkInAt } : {}),
      ...(input.checkOutAt ? { checkOutAt: input.checkOutAt } : {}),
      ...(input.scheduledStartAt ? { scheduledStartAt: input.scheduledStartAt } : {}),
    })
    const context = await this.context(metadata, 'attendance.record', input.userId, idValue)
    return this.audit.execute(context, async (transaction) => {
      transaction.create(tenantDocumentPath(metadata.organizationId, 'attendance_record', idValue), {
        ...base(metadata.organizationId), userId: input.userId, date: input.workDate,
        status: result.status, workedMinutes: result.workedMinutes, source: 'manual',
        ...(input.checkInAt ? { checkInAt: input.checkInAt } : {}),
        ...(input.checkOutAt ? { checkOutAt: input.checkOutAt } : {}),
      })
      return { result: { recordId: idValue, ...result, version: 1 }, resourceType: 'attendance_record', resourceId: idValue, outbox: { type: 'attendance.recorded', version: 1, payload: { recordId: idValue } } }
    })
  }
  async correct(metadata: AttendanceMetadata, attendanceRecordId: string, expectedVersion: number, raw: z.input<typeof recordSchema> & { reason: string }) {
    id.parse(attendanceRecordId)
    const input = recordSchema.extend({ reason: z.string().trim().min(3).max(500) }).strict().parse(raw)
    const current = await this.lookup.get(metadata.organizationId, attendanceRecordId)
    if (!current) throw new Error('ENTITY_NOT_FOUND')
    if (current.userId !== input.userId) throw new Error('ATTENDANCE_USER_MISMATCH')
    const result = deriveAttendanceStatus({
      scheduledMinutes: input.scheduledMinutes, holiday: input.holiday,
      approvedLeave: input.approvedLeave,
      ...(input.checkInAt ? { checkInAt: input.checkInAt } : {}),
      ...(input.checkOutAt ? { checkOutAt: input.checkOutAt } : {}),
      ...(input.scheduledStartAt ? { scheduledStartAt: input.scheduledStartAt } : {}),
    })
    const context = await this.context(metadata, 'attendance.manage', input.userId, attendanceRecordId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'attendance_record', attendanceRecordId)
      const stored = await transaction.get(path)
      if (!stored || stored.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const correctionId = `attendance-correction-${attendanceRecordId}-${expectedVersion + 1}`
      transaction.create(tenantDocumentPath(metadata.organizationId, 'attendance_correction', correctionId), {
        ...base(metadata.organizationId), attendanceRecordId, reason: input.reason,
        beforeStatus: String(stored.status), afterStatus: result.status,
        correctedBy: metadata.principal.userId, correctedAt: SERVER_TIMESTAMP,
      })
      transaction.update(path, { status: result.status, workedMinutes: result.workedMinutes, source: 'correction', ...(input.checkInAt ? { checkInAt: input.checkInAt } : {}), ...(input.checkOutAt ? { checkOutAt: input.checkOutAt } : {}), version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP })
      return { result: { recordId: attendanceRecordId, ...result, version: expectedVersion + 1 }, resourceType: 'attendance_record', resourceId: attendanceRecordId, outbox: { type: 'attendance.corrected', version: 1, payload: { recordId: attendanceRecordId, correctionId } } }
    })
  }
}

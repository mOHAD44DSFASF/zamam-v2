import { randomUUID } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import {
  calculateTimeMinutes, localDateForTimeEntry, SCHEMA_VERSION,
} from '@zamam/domain'
import {
  SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type PageQuery,
  type StoredDocument,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const instant = z.string().datetime()
const note = z.string().trim().max(500).optional()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const entryBase = z.object({
  projectId: id, taskId: id.optional(), billable: z.boolean().default(false),
  note, timezone: z.string().min(1).max(100),
}).strict()
const manualSchema = entryBase.extend({ id, startedAt: instant, endedAt: instant }).strict()
const timerSchema = entryBase.extend({ id }).strict()
const correctionSchema = z.object({
  id, entryId: id, reason: z.string().trim().min(3).max(500),
  proposedStartedAt: instant, proposedEndedAt: instant, proposedNote: note,
}).strict()
const decisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict()
export interface TimeLookupPort {
  findRunning(organizationId: string, userId: string): Promise<StoredDocument | null>
  getEntry(organizationId: string, entryId: string): Promise<StoredDocument | null>
  getTimesheet(organizationId: string, timesheetId: string): Promise<StoredDocument | null>
  getCorrection(organizationId: string, correctionId: string): Promise<StoredDocument | null>
  listPeriodEntries(
    organizationId: string, userId: string, periodStart: string, periodEnd: string,
  ): Promise<readonly StoredDocument[]>
  hasOverlap(
    organizationId: string, userId: string, startedAt: string, endedAt: string,
    excludeEntryId?: string,
  ): Promise<boolean>
}
export interface TimeAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface TimeMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface TimeClock { now(): string }
const base = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const userResource = (organizationId: string, userId: string) => ({
  type: 'user', id: userId, organizationId, ownerUserId: userId,
  visibility: 'restricted' as const,
})
const timesheetId = (userId: string, periodStart: string) =>
  `timesheet-${periodStart.replaceAll('-', '')}-${userId}`
const stringValue = (record: StoredDocument, key: string) => {
  const value = record[key]
  if (typeof value !== 'string') throw new Error('TIME_RECORD_INVALID')
  return value
}
export function buildTimeEntryQuery(input: {
  organizationId: string
  userId: string
  periodStart: string
  periodEnd: string
  limit?: number
  cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); id.parse(input.userId)
  date.parse(input.periodStart); date.parse(input.periodEnd)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'time_entry',
    filters: [
      { field: 'userId', operator: '==', value: input.userId },
      { field: 'localDate', operator: '>=', value: input.periodStart },
      { field: 'localDate', operator: '<=', value: input.periodEnd },
    ],
    orderBy: [{ field: 'localDate', direction: 'desc' }, { field: 'startedAt', direction: 'desc' }],
    limit, ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class TimeTrackingService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: TimeAuthorizationGate,
    private readonly lookup: TimeLookupPort,
    private readonly clock: TimeClock,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }
  private async context(metadata: TimeMetadata, permission: 'time.track' | 'timesheet.submit' | 'timesheet.approve' | 'time.adjust', resourceId: string, ownerUserId = metadata.principal.userId) {
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId,
      resource: userResource(metadata.organizationId, ownerUserId),
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId,
      permission, correlationId: metadata.correlationId,
      idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
      resourceId,
    }
  }
  async startTimer(metadata: TimeMetadata, raw: z.input<typeof timerSchema>) {
    const input = timerSchema.parse(raw)
    const context = await this.context(metadata, 'time.track', input.id)
    const replay = await this.audit.replay<{
      entryId: string
      startedAt: string
      version: number
    }>(context)
    if (replay) return replay
    if (await this.lookup.findRunning(metadata.organizationId, metadata.principal.userId)) {
      throw new Error('TIME_TIMER_ALREADY_RUNNING')
    }
    const startedAt = this.clock.now()
    const localDate = localDateForTimeEntry(startedAt, input.timezone)
    return this.audit.execute(context, async (transaction) => {
      transaction.create(tenantDocumentPath(metadata.organizationId, 'time_entry', input.id), {
        ...base(metadata.organizationId), userId: metadata.principal.userId,
        projectId: input.projectId, ...(input.taskId ? { taskId: input.taskId } : {}),
        billable: input.billable, ...(input.note ? { note: input.note } : {}),
        startedAt, minutes: 0, status: 'draft', timerState: 'running',
        timezone: input.timezone, localDate,
      })
      return {
        result: { entryId: input.id, startedAt, version: 1 },
        resourceType: 'time_entry', resourceId: input.id,
        outbox: { type: 'time.timer_started', version: 1, payload: { entryId: input.id } },
      }
    })
  }
  async stopTimer(metadata: TimeMetadata, entryId: string, expectedVersion: number) {
    id.parse(entryId)
    const record = await this.lookup.getEntry(metadata.organizationId, entryId)
    if (!record) throw new Error('ENTITY_NOT_FOUND')
    if (record.userId !== metadata.principal.userId) throw new Error('TIME_ENTRY_OWNER_REQUIRED')
    if (record.timerState !== 'running' || record.status !== 'draft') throw new Error('TIME_TIMER_NOT_RUNNING')
    const endedAt = this.clock.now()
    const startedAt = stringValue(record, 'startedAt')
    const minutes = calculateTimeMinutes({ startedAt, endedAt })
    if (await this.lookup.hasOverlap(
      metadata.organizationId, metadata.principal.userId, startedAt, endedAt, entryId,
    )) throw new Error('TIME_ENTRY_OVERLAP')
    const context = await this.context(metadata, 'time.track', entryId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'time_entry', entryId)
      const current = await transaction.get(path)
      if (!current || current.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      if (current.timerState !== 'running') throw new Error('TIME_TIMER_NOT_RUNNING')
      transaction.update(path, {
        endedAt, minutes, timerState: 'stopped',
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { entryId, endedAt, minutes, version: expectedVersion + 1 },
        resourceType: 'time_entry', resourceId: entryId,
        outbox: { type: 'time.timer_stopped', version: 1, payload: { entryId, minutes } },
      }
    })
  }
  async createManual(metadata: TimeMetadata, raw: z.input<typeof manualSchema>) {
    const input = manualSchema.parse(raw)
    const minutes = calculateTimeMinutes(input)
    if (Date.parse(input.endedAt) > Date.parse(this.clock.now())) throw new Error('TIME_ENTRY_FUTURE_DENIED')
    if (await this.lookup.hasOverlap(
      metadata.organizationId, metadata.principal.userId, input.startedAt, input.endedAt,
    )) throw new Error('TIME_ENTRY_OVERLAP')
    const context = await this.context(metadata, 'time.track', input.id)
    return this.audit.execute(context, async (transaction) => {
      transaction.create(tenantDocumentPath(metadata.organizationId, 'time_entry', input.id), {
        ...base(metadata.organizationId), userId: metadata.principal.userId,
        projectId: input.projectId, ...(input.taskId ? { taskId: input.taskId } : {}),
        billable: input.billable, ...(input.note ? { note: input.note } : {}),
        startedAt: input.startedAt, endedAt: input.endedAt, minutes,
        status: 'draft', timerState: 'stopped', timezone: input.timezone,
        localDate: localDateForTimeEntry(input.startedAt, input.timezone),
      })
      return {
        result: { entryId: input.id, minutes, version: 1 },
        resourceType: 'time_entry', resourceId: input.id,
        outbox: { type: 'time.entry_created', version: 1, payload: { entryId: input.id, minutes } },
      }
    })
  }
  async submitTimesheet(metadata: TimeMetadata, periodStart: string, periodEnd: string) {
    date.parse(periodStart); date.parse(periodEnd)
    if (periodEnd < periodStart) throw new Error('TIMESHEET_PERIOD_INVALID')
    const sheetId = timesheetId(metadata.principal.userId, periodStart)
    const entries = await this.lookup.listPeriodEntries(
      metadata.organizationId, metadata.principal.userId, periodStart, periodEnd,
    )
    if (!entries.length) throw new Error('TIMESHEET_EMPTY')
    if (entries.length > 100) throw new Error('TIMESHEET_TOO_LARGE')
    if (entries.some((entry) => entry.timerState !== 'stopped'
      || !['draft', 'rejected'].includes(String(entry.status)))) {
      throw new Error('TIMESHEET_ENTRY_NOT_SUBMITTABLE')
    }
    const totalMinutes = entries.reduce((sum, entry) => sum + Number(entry.minutes), 0)
    const context = await this.context(metadata, 'timesheet.submit', sheetId)
    return this.audit.execute(context, async (transaction) => {
      const sheetPath = tenantDocumentPath(metadata.organizationId, 'timesheet', sheetId)
      const existing = await transaction.get(sheetPath)
      if (existing && !['open', 'rejected'].includes(String(existing.status))) {
        throw new Error('TIMESHEET_NOT_OPEN')
      }
      for (const entry of entries) {
        const entryId = stringValue(entry, 'id')
        const path = tenantDocumentPath(metadata.organizationId, 'time_entry', entryId)
        const current = await transaction.get(path)
        if (!current || !['draft', 'rejected'].includes(String(current.status))) {
          throw new Error('TIMESHEET_ENTRY_STATE_CHANGED')
        }
        transaction.update(path, {
          status: 'submitted', timesheetId: sheetId,
          version: Number(current.version) + 1, updatedAt: SERVER_TIMESTAMP,
        })
      }
      const data = {
        userId: metadata.principal.userId, periodStart, periodEnd,
        status: 'submitted', totalMinutes, entryCount: entries.length,
        submittedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
      }
      if (existing) transaction.update(sheetPath, {
        ...data, version: Number(existing.version) + 1,
      })
      else transaction.create(sheetPath, { ...base(metadata.organizationId), ...data })
      return {
        result: { timesheetId: sheetId, totalMinutes, entryCount: entries.length },
        resourceType: 'timesheet', resourceId: sheetId,
        outbox: { type: 'timesheet.submitted', version: 1, payload: { timesheetId: sheetId } },
      }
    })
  }
  async decideTimesheet(
    metadata: TimeMetadata, sheetId: string,
    raw: z.input<typeof decisionSchema>,
  ) {
    id.parse(sheetId)
    const input = decisionSchema.parse(raw)
    if (input.decision === 'rejected' && !input.reason) throw new Error('TIMESHEET_REJECTION_REASON_REQUIRED')
    const sheet = await this.lookup.getTimesheet(metadata.organizationId, sheetId)
    if (!sheet) throw new Error('ENTITY_NOT_FOUND')
    const ownerUserId = stringValue(sheet, 'userId')
    if (ownerUserId === metadata.principal.userId) throw new Error('TIMESHEET_SELF_APPROVAL_DENIED')
    if (sheet.status !== 'submitted') throw new Error('TIMESHEET_NOT_SUBMITTED')
    const entries = await this.lookup.listPeriodEntries(
      metadata.organizationId, ownerUserId,
      stringValue(sheet, 'periodStart'), stringValue(sheet, 'periodEnd'),
    )
    const context = await this.context(metadata, 'timesheet.approve', sheetId, ownerUserId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'timesheet', sheetId)
      const current = await transaction.get(path)
      if (!current || current.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT')
      if (current.status !== 'submitted') throw new Error('TIMESHEET_NOT_SUBMITTED')
      for (const entry of entries.filter((candidate) => candidate.timesheetId === sheetId)) {
        const entryId = stringValue(entry, 'id')
        const entryPath = tenantDocumentPath(metadata.organizationId, 'time_entry', entryId)
        const stored = await transaction.get(entryPath)
        if (!stored || stored.status !== 'submitted') throw new Error('TIMESHEET_ENTRY_STATE_CHANGED')
        transaction.update(entryPath, {
          status: input.decision === 'approved' ? 'approved' : 'rejected',
          version: Number(stored.version) + 1, updatedAt: SERVER_TIMESTAMP,
        })
      }
      transaction.update(path, {
        status: input.decision, approverUserId: metadata.principal.userId,
        ...(input.decision === 'approved'
          ? { approvedAt: SERVER_TIMESTAMP }
          : { rejectionReason: input.reason }),
        version: input.expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { timesheetId: sheetId, status: input.decision, version: input.expectedVersion + 1 },
        resourceType: 'timesheet', resourceId: sheetId,
        outbox: { type: `timesheet.${input.decision}`, version: 1, payload: { timesheetId: sheetId } },
      }
    })
  }
  async requestCorrection(metadata: TimeMetadata, raw: z.input<typeof correctionSchema>) {
    const input = correctionSchema.parse(raw)
    const original = await this.lookup.getEntry(metadata.organizationId, input.entryId)
    if (!original) throw new Error('ENTITY_NOT_FOUND')
    if (original.userId !== metadata.principal.userId) throw new Error('TIME_ENTRY_OWNER_REQUIRED')
    if (original.status !== 'approved') throw new Error('TIME_CORRECTION_APPROVED_ENTRY_REQUIRED')
    const proposedMinutes = calculateTimeMinutes({
      startedAt: input.proposedStartedAt, endedAt: input.proposedEndedAt,
    })
    if (await this.lookup.hasOverlap(
      metadata.organizationId, metadata.principal.userId,
      input.proposedStartedAt, input.proposedEndedAt, input.entryId,
    )) throw new Error('TIME_ENTRY_OVERLAP')
    const context = await this.context(metadata, 'time.track', input.id)
    return this.audit.execute(context, async (transaction) => {
      transaction.create(tenantDocumentPath(metadata.organizationId, 'time_correction', input.id), {
        ...base(metadata.organizationId), originalEntryId: input.entryId,
        requestedBy: metadata.principal.userId, reason: input.reason,
        proposedStartedAt: input.proposedStartedAt, proposedEndedAt: input.proposedEndedAt,
        proposedMinutes, ...(input.proposedNote ? { proposedNote: input.proposedNote } : {}),
        status: 'pending',
      })
      return {
        result: { correctionId: input.id, status: 'pending' as const, version: 1 },
        resourceType: 'time_correction', resourceId: input.id,
        outbox: { type: 'time.correction_requested', version: 1, payload: { correctionId: input.id } },
      }
    })
  }
  async decideCorrection(
    metadata: TimeMetadata, correctionId: string,
    raw: z.input<typeof decisionSchema>,
  ) {
    id.parse(correctionId)
    const input = decisionSchema.parse(raw)
    const correction = await this.lookup.getCorrection(metadata.organizationId, correctionId)
    if (!correction) throw new Error('ENTITY_NOT_FOUND')
    if (correction.status !== 'pending') throw new Error('TIME_CORRECTION_NOT_PENDING')
    const originalEntryId = stringValue(correction, 'originalEntryId')
    const original = await this.lookup.getEntry(metadata.organizationId, originalEntryId)
    if (!original || original.status !== 'approved') throw new Error('TIME_ORIGINAL_EVIDENCE_INVALID')
    const ownerUserId = stringValue(original, 'userId')
    if (ownerUserId === metadata.principal.userId) throw new Error('TIME_CORRECTION_SELF_APPROVAL_DENIED')
    const replacementEntryId = `time-${randomUUID()}`
    const context = await this.context(metadata, 'time.adjust', correctionId, ownerUserId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'time_correction', correctionId)
      const current = await transaction.get(path)
      if (!current || current.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT')
      if (current.status !== 'pending') throw new Error('TIME_CORRECTION_NOT_PENDING')
      if (input.decision === 'approved') {
        transaction.create(tenantDocumentPath(
          metadata.organizationId, 'time_entry', replacementEntryId,
        ), {
          ...base(metadata.organizationId), userId: ownerUserId,
          projectId: stringValue(original, 'projectId'),
          ...(typeof original.taskId === 'string' ? { taskId: original.taskId } : {}),
          billable: original.billable === true,
          ...(typeof current.proposedNote === 'string' ? { note: current.proposedNote } : {}),
          startedAt: stringValue(current, 'proposedStartedAt'),
          endedAt: stringValue(current, 'proposedEndedAt'),
          minutes: Number(current.proposedMinutes), status: 'approved',
          timerState: 'stopped', timezone: stringValue(original, 'timezone'),
          localDate: localDateForTimeEntry(
            stringValue(current, 'proposedStartedAt'), stringValue(original, 'timezone'),
          ),
          supersedesEntryId: originalEntryId,
        })
      }
      transaction.update(path, {
        status: input.decision, decidedBy: metadata.principal.userId,
        decidedAt: SERVER_TIMESTAMP,
        ...(input.decision === 'approved' ? { replacementEntryId } : {}),
        version: input.expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: {
          correctionId, status: input.decision,
          replacementEntryId: input.decision === 'approved' ? replacementEntryId : null,
          version: input.expectedVersion + 1,
        },
        resourceType: 'time_correction', resourceId: correctionId,
        outbox: { type: `time.correction_${input.decision}`, version: 1, payload: { correctionId } },
      }
    })
  }
}

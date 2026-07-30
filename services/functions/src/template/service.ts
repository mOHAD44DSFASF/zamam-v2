import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest, AuthorizationScope } from '@zamam/authorization'
import { SCHEMA_VERSION, nextRecurrenceOccurrence, type RecurrenceRule } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type AtomicTransaction, type PageQuery, type StoredDocument } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const ruleSchema = z.object({
  timezone: z.string(), frequency: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(365), timeLocal: z.string(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
}).strict()

export interface TemplateAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface TemplateMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface TemplateMaterializer {
  materialize(transaction: AtomicTransaction, input: {
    organizationId: string
    templateType: 'task' | 'project'
    templatePayload: Readonly<Record<string, unknown>>
    workflowVersionId?: string
    occurrenceAt: string
    runId: string
    runAsUserId: string
    scope: AuthorizationScope
  }): Promise<{ resourceType: string; resourceId: string }>
}
const base = (organizationId: string) => ({ organizationId, schemaVersion: SCHEMA_VERSION, version: 1, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP })
const owned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path); if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED'); return record
}
const runId = (scheduleId: string, occurrenceAt: string) => `run-${createHash('sha256').update(`${scheduleId}:${occurrenceAt}`).digest('hex').slice(0, 32)}`

export function buildDueRecurrenceQuery(input: { organizationId: string; now: string; limit?: number; cursor?: readonly unknown[] }): PageQuery {
  id.parse(input.organizationId); z.string().datetime().parse(input.now)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'recurrence_schedule',
    filters: [{ field: 'status', operator: '==', value: 'active' }, { field: 'nextRunAt', operator: '<=', value: input.now }],
    orderBy: [{ field: 'nextRunAt', direction: 'asc' }], limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class TemplateService {
  private readonly audit: AuditCommandService
  constructor(private readonly store: AtomicStore, private readonly authorization: TemplateAuthorizationGate, private readonly materializer: TemplateMaterializer, audit?: AuditCommandService) {
    this.audit = audit ?? new AuditCommandService(store)
  }
  private async context(metadata: TemplateMetadata, permission: 'template.create' | 'template.publish' | 'recurrence.manage' | 'recurrence.run', resourceId: string, stepUp = false) {
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId, requireStepUp: stepUp,
      resource: { type: 'work_template', id: resourceId, organizationId: metadata.organizationId, visibility: 'internal' },
    })
    return { organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission, correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint }
  }
  async create(metadata: TemplateMetadata, input: { id: string; name: string; templateType: 'task' | 'project'; payload: Readonly<Record<string, unknown>>; workflowVersionId?: string }) {
    id.parse(input.id)
    const context = await this.context(metadata, 'template.create', input.id)
    return this.audit.execute(context, async (transaction) => {
      if (input.workflowVersionId) {
        const workflow = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'workflow_version', input.workflowVersionId), metadata.organizationId)
        if (workflow.status !== 'published') throw new Error('TEMPLATE_WORKFLOW_NOT_PUBLISHED')
      }
      const path = tenantDocumentPath(metadata.organizationId, 'work_template', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, { ...base(metadata.organizationId), ...input, name: input.name.trim(), status: 'draft' })
      return { result: { templateId: input.id, version: 1 }, resourceType: 'work_template', resourceId: input.id, outbox: { type: 'template.created', version: 1, payload: { templateId: input.id } } }
    })
  }
  async publish(metadata: TemplateMetadata, templateId: string, expectedVersion: number) {
    id.parse(templateId)
    const context = await this.context(metadata, 'template.publish', templateId, true)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'work_template', templateId)
      const template = await owned(transaction, path, metadata.organizationId)
      if (template.version !== expectedVersion || template.status !== 'draft') throw new Error('TEMPLATE_PUBLISH_STATE_INVALID')
      transaction.update(path, { status: 'published', publishedAt: SERVER_TIMESTAMP, publishedBy: metadata.principal.userId, version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP })
      return { result: { templateId, version: expectedVersion + 1 }, resourceType: 'work_template', resourceId: templateId, outbox: { type: 'template.published', version: 1, payload: { templateId } } }
    })
  }
  async createSchedule(metadata: TemplateMetadata, input: { id: string; templateId: string; rule: RecurrenceRule; firstRunAfter: string; runAsUserId: string; scope: AuthorizationScope }) {
    id.parse(input.id); id.parse(input.templateId); id.parse(input.runAsUserId); ruleSchema.parse(input.rule)
    const context = await this.context(metadata, 'recurrence.manage', input.id)
    const nextRunAt = nextRecurrenceOccurrence(input.rule, input.firstRunAfter)
    return this.audit.execute(context, async (transaction) => {
      const template = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'work_template', input.templateId), metadata.organizationId)
      if (template.status !== 'published') throw new Error('RECURRENCE_TEMPLATE_NOT_PUBLISHED')
      const path = tenantDocumentPath(metadata.organizationId, 'recurrence_schedule', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, { ...base(metadata.organizationId), templateId: input.templateId, status: 'active', ...input.rule, nextRunAt, runAsUserId: input.runAsUserId, scopeType: input.scope.type, scopeId: input.scope.id })
      return { result: { scheduleId: input.id, nextRunAt }, resourceType: 'recurrence_schedule', resourceId: input.id, outbox: { type: 'recurrence.scheduled', version: 1, payload: { scheduleId: input.id, nextRunAt } } }
    })
  }
  async runOccurrence(metadata: TemplateMetadata, scheduleId: string, occurrenceAt: string) {
    id.parse(scheduleId); z.string().datetime().parse(occurrenceAt)
    const context = await this.context(metadata, 'recurrence.run', scheduleId)
    return this.audit.execute<{
      runId: string
      resourceType: string
      resourceId: string
      nextRunAt?: string
    }>(context, async (transaction) => {
      const schedulePath = tenantDocumentPath(metadata.organizationId, 'recurrence_schedule', scheduleId)
      const schedule = await owned(transaction, schedulePath, metadata.organizationId)
      if (schedule.status !== 'active') throw new Error('RECURRENCE_NOT_ACTIVE')
      if (schedule.nextRunAt !== occurrenceAt) throw new Error('RECURRENCE_OCCURRENCE_STALE')
      const template = await owned(transaction, tenantDocumentPath(metadata.organizationId, 'work_template', String(schedule.templateId)), metadata.organizationId)
      if (template.status !== 'published') throw new Error('RECURRENCE_TEMPLATE_NOT_PUBLISHED')
      const occurrenceRunId = runId(scheduleId, occurrenceAt)
      const runPath = tenantDocumentPath(metadata.organizationId, 'recurrence_run', occurrenceRunId)
      const existing = await transaction.get(runPath)
      if (existing) return {
        result: {
          runId: occurrenceRunId,
          resourceType: String(existing.generatedResourceType),
          resourceId: String(existing.generatedResourceId),
        },
        resourceType: 'recurrence_run', resourceId: occurrenceRunId,
        outbox: { type: 'recurrence.replayed', version: 1, payload: { scheduleId, runId: occurrenceRunId } },
      }
      const generated = await this.materializer.materialize(transaction, {
        organizationId: metadata.organizationId, templateType: template.templateType as 'task' | 'project',
        templatePayload: template.payload as StoredDocument,
        ...(typeof template.workflowVersionId === 'string' ? { workflowVersionId: template.workflowVersionId } : {}),
        occurrenceAt, runId: occurrenceRunId, runAsUserId: String(schedule.runAsUserId),
        scope: { type: schedule.scopeType as AuthorizationScope['type'], id: String(schedule.scopeId) },
      })
      transaction.create(runPath, { ...base(metadata.organizationId), scheduleId, templateId: schedule.templateId, occurrenceAt, status: 'completed', generatedResourceType: generated.resourceType, generatedResourceId: generated.resourceId })
      const rule: RecurrenceRule = {
        timezone: String(schedule.timezone), frequency: schedule.frequency as RecurrenceRule['frequency'],
        interval: Number(schedule.interval), timeLocal: String(schedule.timeLocal),
        ...(Array.isArray(schedule.daysOfWeek) ? { daysOfWeek: schedule.daysOfWeek as number[] } : {}),
        ...(typeof schedule.dayOfMonth === 'number' ? { dayOfMonth: schedule.dayOfMonth } : {}),
      }
      const nextRunAt = nextRecurrenceOccurrence(rule, occurrenceAt)
      transaction.update(schedulePath, { nextRunAt, lastRunAt: occurrenceAt, version: Number(schedule.version) + 1, updatedAt: SERVER_TIMESTAMP })
      return { result: { runId: occurrenceRunId, ...generated, nextRunAt }, resourceType: 'recurrence_run', resourceId: occurrenceRunId, outbox: { type: 'recurrence.completed', version: 1, payload: { scheduleId, runId: occurrenceRunId, ...generated } } }
    })
  }

  async setScheduleStatus(metadata: TemplateMetadata, scheduleId: string, expectedVersion: number, status: 'active' | 'paused', resumeAfter?: string) {
    id.parse(scheduleId)
    const context = await this.context(metadata, 'recurrence.manage', scheduleId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'recurrence_schedule', scheduleId)
      const schedule = await owned(transaction, path, metadata.organizationId)
      if (schedule.version !== expectedVersion || schedule.status === 'archived') throw new Error('VERSION_CONFLICT')
      let nextRunAt = schedule.nextRunAt
      if (status === 'active' && schedule.status === 'paused') {
        if (!resumeAfter) throw new Error('RECURRENCE_RESUME_TIME_REQUIRED')
        const rule: RecurrenceRule = {
          timezone: String(schedule.timezone), frequency: schedule.frequency as RecurrenceRule['frequency'],
          interval: Number(schedule.interval), timeLocal: String(schedule.timeLocal),
          ...(Array.isArray(schedule.daysOfWeek) ? { daysOfWeek: schedule.daysOfWeek as number[] } : {}),
          ...(typeof schedule.dayOfMonth === 'number' ? { dayOfMonth: schedule.dayOfMonth } : {}),
        }
        nextRunAt = nextRecurrenceOccurrence(rule, resumeAfter)
      }
      transaction.update(path, { status, nextRunAt, version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP })
      return { result: { scheduleId, status, nextRunAt, version: expectedVersion + 1 }, resourceType: 'recurrence_schedule', resourceId: scheduleId, outbox: { type: `recurrence.${status}`, version: 1, payload: { scheduleId, nextRunAt } } }
    })
  }
}

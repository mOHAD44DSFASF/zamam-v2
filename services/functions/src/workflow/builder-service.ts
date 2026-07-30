import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { SCHEMA_VERSION, simulateWorkflowPaths, validateWorkflowDefinition, type WorkflowDefinition } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type AtomicTransaction } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const definitionSchema: z.ZodType<WorkflowDefinition> = z.object({
  startStageKey: z.string(),
  stages: z.array(z.object({
    key: z.string(), name: z.string(), type: z.enum(['work', 'review', 'approval', 'automation']),
    terminal: z.boolean(), slaMinutes: z.number().int().min(1).max(525_600).optional(),
  }).strict()),
  transitions: z.array(z.object({
    key: z.string(), from: z.string(), to: z.string(), requiredPermission: z.string(),
    condition: z.object({
      field: z.string(), operator: z.enum(['equals', 'not_equals', 'exists']),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    }).strict().optional(),
  }).strict()),
}).strict()

export interface WorkflowBuilderAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface WorkflowBuilderMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
const base = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const owned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}
const digest = (definition: WorkflowDefinition) => createHash('sha256').update(JSON.stringify(definition)).digest('hex')

export class WorkflowBuilderService {
  private readonly audit: AuditCommandService
  constructor(private readonly store: AtomicStore, private readonly authorization: WorkflowBuilderAuthorizationGate, audit?: AuditCommandService) {
    this.audit = audit ?? new AuditCommandService(store)
  }
  private async context(metadata: WorkflowBuilderMetadata, permission: 'workflow.create' | 'workflow.manage' | 'workflow.publish' | 'workflow.archive', templateId: string, stepUp = false) {
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId, requireStepUp: stepUp,
      resource: { type: 'workflow_template', id: templateId, organizationId: metadata.organizationId, visibility: 'internal' },
    })
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async createDraft(metadata: WorkflowBuilderMetadata, input: { templateId: string; draftVersionId: string; name: string; definition: WorkflowDefinition }) {
    id.parse(input.templateId); id.parse(input.draftVersionId)
    const definition = definitionSchema.parse(input.definition)
    const validation = validateWorkflowDefinition(definition)
    const context = await this.context(metadata, 'workflow.create', input.templateId)
    return this.audit.execute(context, async (transaction) => {
      const templatePath = tenantDocumentPath(metadata.organizationId, 'workflow_template', input.templateId)
      const versionPath = tenantDocumentPath(metadata.organizationId, 'workflow_version', input.draftVersionId)
      if (await transaction.get(templatePath) || await transaction.get(versionPath)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(templatePath, { ...base(metadata.organizationId), name: input.name.trim(), status: 'draft', latestVersionNumber: 0, draftVersionId: input.draftVersionId })
      transaction.create(versionPath, { ...base(metadata.organizationId), templateId: input.templateId, versionNumber: 0, status: 'draft', definition, definitionHash: digest(definition), validationErrors: validation.errors })
      return {
        result: { templateId: input.templateId, draftVersionId: input.draftVersionId, version: 1, valid: validation.valid },
        resourceType: 'workflow_template', resourceId: input.templateId,
        outbox: { type: 'workflow.draft_created', version: 1, payload: { templateId: input.templateId } },
      }
    })
  }

  async updateDraft(metadata: WorkflowBuilderMetadata, draftVersionId: string, expectedVersion: number, rawDefinition: WorkflowDefinition) {
    id.parse(draftVersionId)
    const definition = definitionSchema.parse(rawDefinition)
    const validation = validateWorkflowDefinition(definition)
    const context = await this.context(metadata, 'workflow.manage', draftVersionId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'workflow_version', draftVersionId)
      const draft = await owned(transaction, path, metadata.organizationId)
      if (draft.status !== 'draft') throw new Error('PUBLISHED_WORKFLOW_IMMUTABLE')
      if (draft.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      transaction.update(path, {
        definition, definitionHash: digest(definition), validationErrors: validation.errors,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { draftVersionId, version: expectedVersion + 1, valid: validation.valid, errors: validation.errors },
        resourceType: 'workflow_version', resourceId: draftVersionId,
        outbox: { type: 'workflow.draft_updated', version: 1, payload: { draftVersionId } },
      }
    })
  }

  async publish(metadata: WorkflowBuilderMetadata, input: { templateId: string; draftVersionId: string; expectedTemplateVersion: number; expectedDraftVersion: number; publishedVersionId: string }) {
    for (const value of [input.templateId, input.draftVersionId, input.publishedVersionId]) id.parse(value)
    const context = await this.context(metadata, 'workflow.publish', input.templateId, true)
    return this.audit.execute(context, async (transaction) => {
      const templatePath = tenantDocumentPath(metadata.organizationId, 'workflow_template', input.templateId)
      const draftPath = tenantDocumentPath(metadata.organizationId, 'workflow_version', input.draftVersionId)
      const template = await owned(transaction, templatePath, metadata.organizationId)
      const draft = await owned(transaction, draftPath, metadata.organizationId)
      if (template.version !== input.expectedTemplateVersion || draft.version !== input.expectedDraftVersion) throw new Error('VERSION_CONFLICT')
      if (template.status === 'archived' || draft.status !== 'draft' || draft.templateId !== input.templateId) throw new Error('WORKFLOW_PUBLISH_STATE_INVALID')
      const definition = definitionSchema.parse(draft.definition)
      const validation = validateWorkflowDefinition(definition)
      if (!validation.valid) throw new Error(validation.errors[0])
      const versionNumber = Number(template.latestVersionNumber ?? 0) + 1
      const publishedPath = tenantDocumentPath(metadata.organizationId, 'workflow_version', input.publishedVersionId)
      if (await transaction.get(publishedPath)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(publishedPath, {
        ...base(metadata.organizationId), templateId: input.templateId, versionNumber, status: 'published',
        definition, definitionHash: digest(definition), publishedAt: SERVER_TIMESTAMP, publishedBy: metadata.principal.userId,
      })
      definition.stages.forEach((stage, order) => transaction.create(
        tenantDocumentPath(metadata.organizationId, 'workflow_stage', `${input.publishedVersionId}_${stage.key}`),
        { ...base(metadata.organizationId), workflowVersionId: input.publishedVersionId, ...stage, order },
      ))
      definition.transitions.forEach((transition) => transaction.create(
        tenantDocumentPath(metadata.organizationId, 'workflow_transition', `${input.publishedVersionId}_${transition.key}`),
        { ...base(metadata.organizationId), workflowVersionId: input.publishedVersionId, ...transition },
      ))
      transaction.update(templatePath, {
        status: 'published', latestVersionId: input.publishedVersionId, latestVersionNumber: versionNumber,
        version: input.expectedTemplateVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { templateId: input.templateId, publishedVersionId: input.publishedVersionId, versionNumber },
        resourceType: 'workflow_version', resourceId: input.publishedVersionId,
        outbox: { type: 'workflow.published', version: 1, payload: { templateId: input.templateId, publishedVersionId: input.publishedVersionId, versionNumber } },
      }
    })
  }

  simulate(rawDefinition: WorkflowDefinition) {
    return { paths: simulateWorkflowPaths(definitionSchema.parse(rawDefinition)), validation: validateWorkflowDefinition(rawDefinition) }
  }
}


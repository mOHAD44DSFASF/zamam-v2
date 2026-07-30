import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { SCHEMA_VERSION, validateAutomationDefinition, type AutomationAction, type AutomationCondition } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'
const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const schema = z.object({ id, name: z.string().trim().min(2).max(120), definitionVersion: z.number().int().positive(), triggerEvent: z.string(), conditions: z.array(z.object({ field: z.string(), operator: z.enum(['eq','in']), value: z.union([z.string(), z.array(z.string())]) }).strict()), actions: z.array(z.object({ type: z.enum(['notification.create','task.add_watcher','task.add_tag']), arguments: z.record(z.string(), z.string()) }).strict()), servicePrincipalId: id, scopeType: z.enum(['organization','department','team','project']), scopeId: id }).strict()
export interface AutomationGate { require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown> }
export interface AutomationMetadata { organizationId: string; principal: AuthorizationPrincipal; correlationId: string; idempotencyKey: string; fingerprint: string }
export class AutomationService {
  private readonly audit: AuditCommandService
  constructor(private readonly store: AtomicStore, private readonly gate: AutomationGate, audit?: AuditCommandService) { this.audit = audit ?? new AuditCommandService(store) }
  async publish(metadata: AutomationMetadata, raw: z.input<typeof schema>) {
    const input = schema.parse(raw)
    validateAutomationDefinition({ triggerEvent: input.triggerEvent, conditions: input.conditions as AutomationCondition[], actions: input.actions as AutomationAction[] })
    await this.gate.require(metadata.principal, { permission: 'automation.publish', organizationId: metadata.organizationId, requireStepUp: true, resource: { type: input.scopeType, id: input.scopeId, organizationId: metadata.organizationId, visibility: 'restricted' } })
    const context = { organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission: 'automation.publish' as const, correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint }
    return this.audit.execute(context, async (transaction) => {
      transaction.create(tenantDocumentPath(metadata.organizationId, 'automation', input.id), { organizationId: metadata.organizationId, schemaVersion: SCHEMA_VERSION, version: 1, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP, name: input.name, status: 'active', definitionVersion: input.definitionVersion, triggerType: input.triggerEvent, conditions: input.conditions, actions: input.actions, servicePrincipalId: input.servicePrincipalId, scopeType: input.scopeType, scopeId: input.scopeId, riskLevel: 'low', publishedAt: SERVER_TIMESTAMP })
      return { result: { automationId: input.id, status: 'active' as const, version: 1 }, resourceType: 'automation', resourceId: input.id, outbox: { type: 'automation.published', version: 1, payload: { automationId: input.id } } }
    })
  }
}

import { tenantDocumentPath } from '@zamam/firestore'
import { WorkflowBuilderService } from '../../workflow/builder-service.js'
import { WorkflowExecutionService, type BusinessCalendarPort, type WorkflowClock, type WorkflowGatePort } from '../../workflow/execution-service.js'
import type { Deps } from '../deps.js'
import { listQuery, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

// v1 simplification: Gulf-region weekend (Friday/Saturday) skipped minute-by-minute; no per-organization business calendar yet.
function createCalendarPort(): BusinessCalendarPort {
  return {
    async addBusinessMinutes(_organizationId, from, minutes) {
      const cursor = new Date(from)
      let remaining = minutes
      while (remaining > 0) {
        cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
        const day = cursor.getUTCDay()
        if (day !== 5 && day !== 6) remaining -= 1
      }
      return cursor.toISOString()
    },
  }
}

function createGatePort(deps: Deps): WorkflowGatePort {
  return {
    async validate(input) {
      const instance = await readDoc(deps.firestore, tenantDocumentPath(input.organizationId, 'task_workflow_instance', input.instanceId))
      if (!instance) return { valid: false, errors: ['WORKFLOW_INSTANCE_NOT_FOUND'] }
      const stage = await readDoc(deps.firestore, tenantDocumentPath(input.organizationId, 'workflow_stage', `${instance.workflowVersionId}_${input.stageKey}`))
      if (!stage || (stage.type !== 'review' && stage.type !== 'approval')) return { valid: true, errors: [] }
      const requests = await listQuery(deps, input.organizationId, 'review_request', {
        filters: [{ field: 'taskId', operator: '==', value: input.taskId }, { field: 'status', operator: '==', value: 'approved' }],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
      })
      return requests.items.length > 0 ? { valid: true, errors: [] } : { valid: false, errors: ['WORKFLOW_GATE_APPROVAL_REQUIRED'] }
    },
  }
}

const clock: WorkflowClock = { now: () => new Date().toISOString() }

export function createWorkflowHandlers(deps: Deps): HandlerRegistry {
  const builder = new WorkflowBuilderService(deps.store, deps.authorization)
  const execution = new WorkflowExecutionService(deps.store, deps.authorization, createGatePort(deps), createCalendarPort(), clock)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof builder.createDraft>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/workflows/builder/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'workflow.view', organizationId: context.organizationId })
      const templates = await listQuery(deps, context.organizationId, 'workflow_template', {
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 50,
      })
      return { items: templates.items }
    },
    '/v1/workflows/drafts/update': (context, input) => builder.updateDraft(
      metadata(context), requireString(input, 'draftVersionId'), requireNumber(input, 'expectedVersion'),
      input.definition as Parameters<typeof builder.updateDraft>[3],
    ),
    '/v1/workflows/simulate': async (_context, input) => builder.simulate(input.definition as Parameters<typeof builder.simulate>[0]),
    '/v1/workflows/publish': (context, input) => builder.publish(metadata(context), {
      templateId: requireString(input, 'templateId'), draftVersionId: requireString(input, 'draftVersionId'),
      expectedTemplateVersion: requireNumber(input, 'expectedTemplateVersion'),
      expectedDraftVersion: requireNumber(input, 'expectedDraftVersion'),
      publishedVersionId: requireString(input, 'publishedVersionId'),
    }),
    '/v1/workflows/instances/transition': (context, input) => execution.transition(metadata(context), {
      instanceId: requireString(input, 'instanceId'), transitionKey: requireString(input, 'transitionKey'),
      expectedConcurrencyVersion: requireNumber(input, 'expectedConcurrencyVersion'),
    }),
  }
}

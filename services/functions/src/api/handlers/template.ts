import { TemplateService, type TemplateMaterializer } from '../../template/service.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

const materializer: TemplateMaterializer = {
  async materialize() { throw new Error('RECURRENCE_MATERIALIZATION_NOT_CONFIGURED') },
}

export function createTemplateHandlers(deps: Deps): HandlerRegistry {
  const service = new TemplateService(deps.store, deps.authorization, materializer)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.create>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/templates/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'template.view', organizationId: context.organizationId })
      const page = await listQuery(deps, context.organizationId, 'work_template', {
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 50,
      })
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        create: 'template.create', publish: 'template.publish', manageRecurrence: 'recurrence.manage',
      })
      return { items: page.items, capabilities }
    },
    '/v1/templates/create': (context, input) => service.create(metadata(context), {
      id: requireString(input, 'id'), name: requireString(input, 'name'),
      templateType: requireString(input, 'templateType') as 'task' | 'project',
      payload: (input.payload ?? {}) as Record<string, unknown>,
      ...(typeof input.workflowVersionId === 'string' ? { workflowVersionId: input.workflowVersionId } : {}),
    }),
    '/v1/templates/publish': (context, input) => service.publish(
      metadata(context), requireString(input, 'templateId'), requireNumber(input, 'expectedVersion'),
    ),
    '/v1/recurrences/status': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'recurrence.manage', organizationId: context.organizationId })
      const page = await listQuery(deps, context.organizationId, 'recurrence_schedule', {
        orderBy: [{ field: 'nextRunAt', direction: 'asc' }], limit: 50,
      })
      return { items: page.items }
    },
  }
}

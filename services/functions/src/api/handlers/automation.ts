import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, orgPath, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireString } from '../registry.js'

export function createAutomationHandlers(deps: Deps): HandlerRegistry {
  return {
    '/v1/automations/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'automation.view', organizationId: context.organizationId })
      const page = await listQuery(deps, context.organizationId, 'automation', {
        filters: [{ field: 'status', operator: 'in', value: ['draft', 'active', 'paused'] }],
        orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 50,
      })
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        create: 'automation.create', manage: 'automation.manage', publish: 'automation.publish', cancel: 'automation.cancel',
      })
      return { items: page.items, capabilities }
    },
    '/v1/automations/status': async (context, input) => {
      await deps.authorization.require(context.principal, { permission: 'automation.view', organizationId: context.organizationId })
      const automationId = requireString(input, 'automationId')
      const [automation, runs] = await Promise.all([
        readDoc(deps.firestore, orgPath(context.organizationId, 'automation', automationId)),
        listQuery(deps, context.organizationId, 'automation_run', {
          filters: [{ field: 'automationId', operator: '==', value: automationId }],
          orderBy: [{ field: 'startedAt', direction: 'desc' }], limit: 20,
        }),
      ])
      return { automation, runs: runs.items }
    },
  }
}

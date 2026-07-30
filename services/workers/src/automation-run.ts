import { AUTOMATION_ACTION_CATALOG, automationConditionsMatch, type AutomationAction, type AutomationCondition } from '@zamam/domain'
export interface AutomationWorkItem { organizationId: string; automationId: string; automationVersion: number; triggerEventId: string; triggerDepth: number; conditions: readonly AutomationCondition[]; actions: readonly AutomationAction[]; payload: Readonly<Record<string, unknown>>; servicePrincipalId: string; scopeType: string; scopeId: string; attemptCount: number }
export interface AutomationRunStore { begin(runId: string, item: AutomationWorkItem): Promise<'created'|'duplicate'>; complete(runId: string, results: readonly Readonly<Record<string, unknown>>[]): Promise<void>; retry(runId: string, attempt: number, code: string): Promise<void>; deadLetter(runId: string, attempt: number, code: string): Promise<void>; quota(organizationId: string, automationId: string, limit: number): Promise<boolean> }
export interface AutomationActionExecutor { execute(input: { organizationId: string; servicePrincipalId: string; permission: string; scopeType: string; scopeId: string; action: AutomationAction; idempotencyKey: string }): Promise<{ resourceType: string; resourceId: string }> }
const runId = (item: AutomationWorkItem) => `automation-run-${item.automationId}-${item.automationVersion}-${item.triggerEventId}`
export class AutomationRunJob {
  constructor(private readonly store: AutomationRunStore, private readonly executor: AutomationActionExecutor, private readonly maxAttempts = 5) {}
  async run(item: AutomationWorkItem) {
    if (item.triggerDepth >= 3) throw new Error('AUTOMATION_DEPTH_DENIED')
    if (!await this.store.quota(item.organizationId, item.automationId, 100)) throw new Error('AUTOMATION_QUOTA_EXCEEDED')
    const id = runId(item)
    if (await this.store.begin(id, item) === 'duplicate') return { runId: id, duplicate: true }
    if (!automationConditionsMatch(item.conditions, item.payload)) { await this.store.complete(id, [{ status: 'skipped' }]); return { runId: id, skipped: true } }
    const results: Readonly<Record<string, unknown>>[] = []
    try {
      for (let index = 0; index < item.actions.length; index += 1) {
        const action = item.actions[index]!
        const policy = AUTOMATION_ACTION_CATALOG[action.type]
        const result = await this.executor.execute({ organizationId: item.organizationId, servicePrincipalId: item.servicePrincipalId, permission: policy.permission, scopeType: item.scopeType, scopeId: item.scopeId, action, idempotencyKey: `${id}-action-${index}` })
        results.push({ index, type: action.type, status: 'completed', ...result })
      }
      await this.store.complete(id, results); return { runId: id, duplicate: false }
    } catch (error) {
      const attempt = item.attemptCount + 1; const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'AUTOMATION_ACTION_FAILED'
      if (attempt >= this.maxAttempts) await this.store.deadLetter(id, attempt, code)
      else await this.store.retry(id, attempt, code)
      return { runId: id, failed: true, deadLettered: attempt >= this.maxAttempts }
    }
  }
}

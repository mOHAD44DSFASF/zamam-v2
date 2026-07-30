export const AUTOMATION_ACTION_CATALOG = {
  'notification.create': { permission: 'notification.deliver', emits: 'notification.created' },
  'task.add_watcher': { permission: 'task.watcher.manage', emits: 'task.watcher_added' },
  'task.add_tag': { permission: 'task.update', emits: 'task.tag_added' },
} as const
export type AutomationActionType = keyof typeof AUTOMATION_ACTION_CATALOG
export interface AutomationCondition { field: string; operator: 'eq' | 'in'; value: string | readonly string[] }
export interface AutomationAction { type: AutomationActionType; arguments: Readonly<Record<string, string>> }
export interface AutomationDefinitionInput { triggerEvent: string; conditions: readonly AutomationCondition[]; actions: readonly AutomationAction[] }
export function validateAutomationDefinition(input: AutomationDefinitionInput) {
  if (!/^[a-z][a-z0-9_.]{2,80}$/.test(input.triggerEvent)) throw new Error('AUTOMATION_TRIGGER_INVALID')
  if (!input.actions.length || input.actions.length > 5 || input.conditions.length > 10) throw new Error('AUTOMATION_COMPLEXITY_DENIED')
  for (const condition of input.conditions) {
    if (!/^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(condition.field)) throw new Error('AUTOMATION_CONDITION_INVALID')
    if (condition.operator === 'in' && (!Array.isArray(condition.value) || condition.value.length > 20)) throw new Error('AUTOMATION_CONDITION_INVALID')
  }
  for (const action of input.actions) {
    const policy = AUTOMATION_ACTION_CATALOG[action.type]
    if (!policy) throw new Error('AUTOMATION_ACTION_DENIED')
    if (policy.emits === input.triggerEvent) throw new Error('AUTOMATION_DIRECT_LOOP_DENIED')
    if (Object.keys(action.arguments).length > 10) throw new Error('AUTOMATION_ACTION_ARGUMENTS_INVALID')
  }
  return input
}
export function automationConditionsMatch(conditions: readonly AutomationCondition[], payload: Readonly<Record<string, unknown>>) {
  return conditions.every((condition) => {
    const value = payload[condition.field]
    return condition.operator === 'eq' ? value === condition.value : Array.isArray(condition.value) && condition.value.includes(String(value))
  })
}

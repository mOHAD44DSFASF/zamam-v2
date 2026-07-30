export interface WorkflowStageDefinition {
  key: string
  name: string
  type: 'work' | 'review' | 'approval' | 'automation'
  terminal: boolean
  slaMinutes?: number | undefined
}
export interface WorkflowCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'exists'
  value?: string | number | boolean | undefined
}
export interface WorkflowTransitionDefinition {
  key: string
  from: string
  to: string
  requiredPermission: string
  condition?: WorkflowCondition | undefined
}
export interface WorkflowDefinition {
  startStageKey: string
  stages: readonly WorkflowStageDefinition[]
  transitions: readonly WorkflowTransitionDefinition[]
}
export interface WorkflowValidationResult {
  valid: boolean
  errors: readonly string[]
  reachableStageKeys: readonly string[]
  terminalStageKeys: readonly string[]
}

const keyPattern = /^[a-z][a-z0-9_]{1,63}$/

export function validateWorkflowDefinition(definition: WorkflowDefinition): WorkflowValidationResult {
  const errors: string[] = []
  if (definition.stages.length < 2 || definition.stages.length > 50) errors.push('WORKFLOW_STAGE_COUNT_INVALID')
  if (definition.transitions.length < 1 || definition.transitions.length > 200) errors.push('WORKFLOW_TRANSITION_COUNT_INVALID')
  const stageKeys = definition.stages.map(({ key }) => key)
  const stageSet = new Set(stageKeys)
  if (stageSet.size !== stageKeys.length) errors.push('WORKFLOW_STAGE_KEY_DUPLICATE')
  if (definition.stages.some(({ key, name }) => !keyPattern.test(key) || name.trim().length < 2 || name.trim().length > 100)) {
    errors.push('WORKFLOW_STAGE_INVALID')
  }
  if (!stageSet.has(definition.startStageKey)) errors.push('WORKFLOW_START_INVALID')
  const transitionKeys = definition.transitions.map(({ key }) => key)
  if (new Set(transitionKeys).size !== transitionKeys.length) errors.push('WORKFLOW_TRANSITION_KEY_DUPLICATE')
  for (const transition of definition.transitions) {
    if (!keyPattern.test(transition.key) || !stageSet.has(transition.from) || !stageSet.has(transition.to) || transition.from === transition.to) {
      errors.push('WORKFLOW_TRANSITION_INVALID')
    }
    if (!keyPattern.test(transition.requiredPermission.replaceAll('.', '_'))) errors.push('WORKFLOW_PERMISSION_INVALID')
    if (transition.condition && (!keyPattern.test(transition.condition.field.replaceAll('.', '_'))
      || (transition.condition.operator !== 'exists' && transition.condition.value === undefined))) {
      errors.push('WORKFLOW_CONDITION_INVALID')
    }
  }
  const outgoing = new Map<string, string[]>()
  for (const key of stageKeys) outgoing.set(key, [])
  for (const transition of definition.transitions) outgoing.get(transition.from)?.push(transition.to)
  const reachable = new Set<string>()
  const visit = (key: string) => {
    if (reachable.has(key)) return
    reachable.add(key)
    for (const next of outgoing.get(key) ?? []) visit(next)
  }
  if (stageSet.has(definition.startStageKey)) visit(definition.startStageKey)
  if (reachable.size !== stageSet.size) errors.push('WORKFLOW_STAGE_UNREACHABLE')
  const terminalStageKeys = definition.stages.filter(({ terminal }) => terminal).map(({ key }) => key)
  if (terminalStageKeys.length === 0) errors.push('WORKFLOW_TERMINAL_REQUIRED')
  for (const stage of definition.stages) {
    const hasOutgoing = (outgoing.get(stage.key)?.length ?? 0) > 0
    if (stage.terminal && hasOutgoing) errors.push('WORKFLOW_TERMINAL_HAS_OUTGOING')
    if (!stage.terminal && !hasOutgoing) errors.push('WORKFLOW_NON_TERMINAL_DEAD_END')
  }
  const canReachTerminal = new Set(terminalStageKeys)
  let changed = true
  while (changed) {
    changed = false
    for (const transition of definition.transitions) {
      if (canReachTerminal.has(transition.to) && !canReachTerminal.has(transition.from)) {
        canReachTerminal.add(transition.from); changed = true
      }
    }
  }
  if (stageKeys.some((key) => !canReachTerminal.has(key))) errors.push('WORKFLOW_NO_TERMINAL_PATH')
  return { valid: errors.length === 0, errors: [...new Set(errors)], reachableStageKeys: [...reachable], terminalStageKeys }
}

export function simulateWorkflowPaths(definition: WorkflowDefinition, maxPaths = 100) {
  const validation = validateWorkflowDefinition(definition)
  if (!validation.valid) throw new Error(validation.errors[0])
  const outgoing = new Map<string, WorkflowTransitionDefinition[]>()
  for (const transition of definition.transitions) outgoing.set(transition.from, [...(outgoing.get(transition.from) ?? []), transition])
  const paths: string[][] = []
  const walk = (stage: string, path: string[], visits: ReadonlyMap<string, number>) => {
    if (paths.length >= maxPaths) return
    const count = visits.get(stage) ?? 0
    if (count >= 2) return
    const nextVisits = new Map(visits); nextVisits.set(stage, count + 1)
    const node = definition.stages.find(({ key }) => key === stage)!
    const nextPath = [...path, stage]
    if (node.terminal) { paths.push(nextPath); return }
    for (const transition of outgoing.get(stage) ?? []) walk(transition.to, nextPath, nextVisits)
  }
  walk(definition.startStageKey, [], new Map())
  return paths
}

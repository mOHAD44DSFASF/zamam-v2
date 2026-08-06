import { asUtcIsoString } from './base.js'
import type { TaskStatus } from './statuses.js'

export function normalizeTaskTitle(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < 2 || normalized.length > 200) throw new Error('INVALID_TASK_TITLE')
  return normalized
}

export function normalizeTaskDescription(value: string) {
  const normalized = value.trim()
  if (normalized.length > 20_000) throw new Error('INVALID_TASK_DESCRIPTION')
  return normalized
}

export function assertTaskDueAt(value?: string) {
  if (value) asUtcIsoString(value)
}

export function assertTaskStatusTransition(current: TaskStatus, target: TaskStatus) {
  const allowed: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
    draft: ['ready', 'cancelled'],
    ready: ['in_progress', 'blocked', 'cancelled'],
    in_progress: ['blocked', 'in_review', 'completed', 'cancelled'],
    blocked: ['in_progress', 'cancelled'],
    in_review: ['in_progress', 'approved', 'cancelled'],
    approved: ['completed', 'cancelled'],
    completed: ['archived'],
    cancelled: ['archived'],
    archived: [],
  }
  if (!allowed[current].includes(target)) throw new Error('INVALID_TASK_STATUS_TRANSITION')
}

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'cancelled', 'archived'])

export type TaskStepStatus = 'pending' | 'in_progress' | 'done' | 'sent_back'

export interface TaskStepInput {
  name: string
  assigneeType: 'person' | 'department'
  assigneeUserId?: string
  assigneeDepartmentId?: string
  driveLink?: string
}

export const MAX_TASK_STEPS = 20

export function normalizeStepName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < 2 || normalized.length > 160) throw new Error('INVALID_STEP_NAME')
  return normalized
}

export function assertDriveLink(value?: string) {
  if (!value) return
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('INVALID_DRIVE_LINK') }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('INVALID_DRIVE_LINK')
  if (value.length > 2_000) throw new Error('INVALID_DRIVE_LINK')
}

/** A task's step pipeline: 1..MAX_TASK_STEPS ordered steps, each assigned to exactly one person OR one
 * department (any active member of that department may claim/complete it) — validated together (not
 * per-step) so "at least one step" and "no duplicate assignee shape" are checked once at creation time. */
export function assertStepsInput(steps: readonly TaskStepInput[]) {
  if (steps.length < 1) throw new Error('TASK_REQUIRES_AT_LEAST_ONE_STEP')
  if (steps.length > MAX_TASK_STEPS) throw new Error('TASK_STEP_LIMIT_EXCEEDED')
  for (const step of steps) {
    normalizeStepName(step.name)
    assertDriveLink(step.driveLink)
    const hasPerson = Boolean(step.assigneeUserId)
    const hasDepartment = Boolean(step.assigneeDepartmentId)
    if (step.assigneeType === 'person' && (!hasPerson || hasDepartment)) throw new Error('STEP_ASSIGNEE_INVALID')
    if (step.assigneeType === 'department' && (!hasDepartment || hasPerson)) throw new Error('STEP_ASSIGNEE_INVALID')
  }
}

const stepTransitions: Readonly<Record<TaskStepStatus, readonly TaskStepStatus[]>> = {
  pending: ['in_progress', 'sent_back'],
  in_progress: ['done', 'sent_back'],
  done: [],
  sent_back: ['in_progress', 'pending'],
}

export function assertStepStatusTransition(current: TaskStepStatus, target: TaskStepStatus) {
  if (!stepTransitions[current].includes(target)) throw new Error('INVALID_STEP_STATUS_TRANSITION')
}

/** A step may only be sent back to a strictly earlier step in the pipeline — never forward, never to
 * itself. This is the entirety of the "send-back" legality rule; who is allowed to invoke it (the
 * current step's holder) is enforced by the caller via authorization/resource scoping. */
export function assertSendBackTarget(currentOrder: number, targetOrder: number) {
  if (targetOrder >= currentOrder) throw new Error('SEND_BACK_MUST_TARGET_EARLIER_STEP')
}

export function normalizeSendBackReason(value: string) {
  const normalized = value.trim()
  if (normalized.length < 3 || normalized.length > 1_000) throw new Error('SEND_BACK_REASON_REQUIRED')
  return normalized
}


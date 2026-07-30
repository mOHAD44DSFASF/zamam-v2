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


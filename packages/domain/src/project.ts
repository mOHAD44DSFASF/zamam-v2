import { assertDateOnly } from './employee.js'
import { normalizeDirectoryCode, normalizeDirectoryName } from './organization.js'

export const normalizeProjectName = normalizeDirectoryName
export const normalizeProjectCode = normalizeDirectoryCode

export function assertProjectDateRange(startsOn?: string, dueOn?: string) {
  if (startsOn) assertDateOnly(startsOn, 'INVALID_PROJECT_DATE')
  if (dueOn) assertDateOnly(dueOn, 'INVALID_PROJECT_DATE')
  if (startsOn && dueOn && dueOn < startsOn) throw new Error('INVALID_PROJECT_DATE_RANGE')
}

export function assertProjectStatusTransition(current: string, target: string) {
  const allowed: Readonly<Record<string, readonly string[]>> = {
    draft: ['planned', 'cancelled'],
    planned: ['active', 'on_hold', 'cancelled'],
    active: ['on_hold', 'completed', 'cancelled'],
    on_hold: ['active', 'cancelled'],
    completed: ['archived'],
    cancelled: ['archived'],
    archived: [],
  }
  if (!allowed[current]?.includes(target)) throw new Error('INVALID_PROJECT_STATUS_TRANSITION')
}

export interface ProjectProjectionSource {
  id: string
  clientId: string
  name: string
  code: string
  status: string
  startsOn?: string
  dueOn?: string
  clientVisible: boolean
  departmentId?: string
  managerUserId: string
  financial?: unknown
}

export function projectProjectFields(source: ProjectProjectionSource, access: 'client' | 'internal' | 'financial') {
  if (access === 'client' && !source.clientVisible) throw new Error('PROJECT_NOT_CLIENT_VISIBLE')
  const shared = {
    id: source.id, clientId: source.clientId, name: source.name, code: source.code,
    status: source.status, clientVisible: source.clientVisible,
    ...(source.startsOn ? { startsOn: source.startsOn } : {}),
    ...(source.dueOn ? { dueOn: source.dueOn } : {}),
  }
  if (access === 'client') return shared
  const internal = {
    ...shared,
    managerUserId: source.managerUserId,
    ...(source.departmentId ? { departmentId: source.departmentId } : {}),
  }
  return access === 'internal' ? internal : { ...internal, financial: source.financial ?? null }
}

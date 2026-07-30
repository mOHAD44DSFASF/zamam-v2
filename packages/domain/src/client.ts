import { normalizeDirectoryCode, normalizeDirectoryName } from './organization.js'

export const normalizeClientName = normalizeDirectoryName
export const normalizeClientCode = normalizeDirectoryCode

export function assertClientStatusTransition(current: string, target: string) {
  const allowed: Readonly<Record<string, readonly string[]>> = {
    lead: ['active', 'archived'],
    active: ['paused', 'archived'],
    paused: ['active', 'archived'],
    archived: [],
  }
  if (!allowed[current]?.includes(target)) throw new Error('INVALID_CLIENT_STATUS_TRANSITION')
}

export function assertCanArchiveClient(activeProjectCount: number) {
  if (!Number.isInteger(activeProjectCount) || activeProjectCount < 0) throw new Error('INVALID_REFERENCE_COUNT')
  if (activeProjectCount > 0) throw new Error('CLIENT_HAS_ACTIVE_PROJECTS')
}

export interface ClientProjectionSource {
  id: string
  name: string
  code: string
  industry?: string
  status: string
  accountManagerUserId?: string
  financial?: unknown
}

export function projectClientFields(source: ClientProjectionSource, access: 'summary' | 'internal' | 'financial') {
  const summary = {
    id: source.id,
    name: source.name,
    code: source.code,
    status: source.status,
    ...(source.industry ? { industry: source.industry } : {}),
  }
  if (access === 'summary') return summary
  const internal = { ...summary, ...(source.accountManagerUserId ? { accountManagerUserId: source.accountManagerUserId } : {}) }
  return access === 'internal' ? internal : { ...internal, financial: source.financial ?? null }
}

export const ORGANIZATION_NAME_MAX_LENGTH = 160
export const ORGANIZATION_CODE_MAX_LENGTH = 32

export function normalizeDirectoryName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < 2 || normalized.length > ORGANIZATION_NAME_MAX_LENGTH) {
    throw new Error('INVALID_DIRECTORY_NAME')
  }
  return normalized
}

export function normalizeDirectoryCode(value: string) {
  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(normalized)) throw new Error('INVALID_DIRECTORY_CODE')
  return normalized
}

export function normalizeOrganizationSlug(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(normalized)) throw new Error('INVALID_ORGANIZATION_SLUG')
  return normalized
}

export function assertAllocationPercent(value: number | undefined) {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('INVALID_ALLOCATION_PERCENT')
}

export function assertCanArchiveDepartment(activeTeamCount: number) {
  if (!Number.isInteger(activeTeamCount) || activeTeamCount < 0) throw new Error('INVALID_REFERENCE_COUNT')
  if (activeTeamCount > 0) throw new Error('DEPARTMENT_HAS_ACTIVE_TEAMS')
}

export function assertCanArchiveTeam(activeMemberCount: number) {
  if (!Number.isInteger(activeMemberCount) || activeMemberCount < 0) throw new Error('INVALID_REFERENCE_COUNT')
  if (activeMemberCount > 0) throw new Error('TEAM_HAS_ACTIVE_MEMBERS')
}

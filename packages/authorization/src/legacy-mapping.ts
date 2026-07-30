export interface LegacyRoleMigrationProposal {
  legacyRole: string
  proposedRole: 'GeneralManager' | 'DeputyManager' | 'Employee' | 'ScopedCustomRole' | null
  status: 'proposed' | 'quarantine'
  requiresScopeResolution: boolean
  grantsApplied: false
  reason: string
}

export function proposeLegacyRoleMapping(legacyRole: string): LegacyRoleMigrationProposal {
  const normalized = legacyRole.trim()
  if (normalized === 'Admin') return {
    legacyRole, proposedRole: 'GeneralManager', status: 'proposed', requiresScopeResolution: false,
    grantsApplied: false, reason: 'Admin never implies Owner; secure bootstrap creates the first Owner.',
  }
  if (normalized === 'DeputyManager') return {
    legacyRole, proposedRole: 'DeputyManager', status: 'proposed', requiresScopeResolution: true,
    grantsApplied: false, reason: 'Delegated permissions and validity period must be resolved.',
  }
  if (normalized === 'Creator') return {
    legacyRole, proposedRole: 'Employee', status: 'proposed', requiresScopeResolution: true,
    grantsApplied: false, reason: 'Employee membership and task scope must be confirmed.',
  }
  if (normalized === 'Reviewer' || normalized === 'Uploader') return {
    legacyRole, proposedRole: 'ScopedCustomRole', status: 'quarantine', requiresScopeResolution: true,
    grantsApplied: false, reason: 'Pipeline labels do not establish a trusted permission set.',
  }
  return {
    legacyRole, proposedRole: null, status: 'quarantine', requiresScopeResolution: true,
    grantsApplied: false, reason: 'Manager and dynamic role names are ambiguous and receive no V2 privilege.',
  }
}

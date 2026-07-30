import { normalizeDirectoryName } from './organization.js'

export const normalizeWorkspaceName = normalizeDirectoryName

export function assertWorkspaceStatusTransition(current: string, target: string) {
  const allowed: Readonly<Record<string, readonly string[]>> = {
    active: ['archived'],
    archived: [],
  }
  if (!allowed[current]?.includes(target)) throw new Error('INVALID_WORKSPACE_STATUS_TRANSITION')
}

export function assertWorkspaceScope(input: {
  visibility: 'private' | 'team' | 'project'
  projectId?: string | undefined
  departmentId?: string | undefined
  ownerTeamId?: string | undefined
}) {
  if (input.visibility === 'project' && !input.projectId) throw new Error('WORKSPACE_PROJECT_REQUIRED')
  if (input.visibility === 'team' && !input.ownerTeamId) throw new Error('WORKSPACE_TEAM_REQUIRED')
  if (input.ownerTeamId && !input.departmentId) throw new Error('WORKSPACE_DEPARTMENT_REQUIRED')
}

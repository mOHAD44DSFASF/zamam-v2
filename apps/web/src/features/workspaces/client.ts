import { auth } from '../../lib/firebase'

export interface WorkspaceSummary {
  id: string
  name: string
  status: 'active' | 'archived'
  visibility: 'private' | 'team' | 'project'
  projectName: string | null
  teamName: string | null
  activeMemberCount: number
  openTaskCount: number
  version: number
}
export interface WorkspaceSnapshot {
  workspaces: readonly WorkspaceSummary[]
  projects: readonly { id: string; name: string; departmentId?: string }[]
  teams: readonly { id: string; name: string; departmentId: string }[]
  capabilities: { create: boolean; manageMembers: boolean; archive: boolean }
}
export interface WorkspaceClient {
  load(organizationId: string): Promise<WorkspaceSnapshot>
  create(organizationId: string, input: {
    name: string
    visibility: 'private' | 'team' | 'project'
    projectId?: string
    departmentId?: string
    ownerTeamId?: string
  }): Promise<void>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL
  const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
      'x-idempotency-key': crypto.randomUUID(),
      ...(import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ? { 'x-firebase-appcheck': 'emulator-app-check' } : {}),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'WORKSPACE_REQUEST_FAILED')
  return envelope.data
}

export const workspaceClient: WorkspaceClient = {
  load: (organizationId) => post('/v1/workspaces/query', { organizationId, limit: 50 }),
  create: (organizationId, input) => post('/v1/workspaces/create', { organizationId, id: crypto.randomUUID(), ...input }),
}


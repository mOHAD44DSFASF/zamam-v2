import { appCheckHeaders, auth } from '../../lib/firebase'

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
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'WORKSPACE_REQUEST_FAILED')
  return envelope.data
}

interface RawWorkspaceRow { id?: unknown; name?: unknown; status?: unknown; visibility?: unknown; version?: unknown }

/**
 * `/v1/workspaces/query` returns `{ items }` — raw workspace docs, not the WorkspaceSnapshot (project/
 * team names, counts, capability flags, and the projects/teams pick-lists) this screen expects. Adapter
 * maps the real workspaces into a valid snapshot; derived names/counts placeholder, pick-lists empty,
 * capabilities fail closed (backend still enforces). Tracked as audit M1/M2.
 */
function toWorkspaceSnapshot(raw: { items?: readonly RawWorkspaceRow[] }): WorkspaceSnapshot {
  const workspaces: WorkspaceSummary[] = (raw.items ?? []).map((row) => ({
    id: String(row.id ?? ''), name: typeof row.name === 'string' ? row.name : '',
    status: (typeof row.status === 'string' ? row.status : 'active') as WorkspaceSummary['status'],
    visibility: (typeof row.visibility === 'string' ? row.visibility : 'private') as WorkspaceSummary['visibility'],
    projectName: null, teamName: null, activeMemberCount: 0, openTaskCount: 0,
    version: typeof row.version === 'number' ? row.version : 1,
  }))
  return { workspaces, projects: [], teams: [], capabilities: { create: false, manageMembers: false, archive: false } }
}

export const workspaceClient: WorkspaceClient = {
  load: async (organizationId) => toWorkspaceSnapshot(await post('/v1/workspaces/query', { organizationId, limit: 50 })),
  create: (organizationId, input) => post('/v1/workspaces/create', { organizationId, id: crypto.randomUUID(), ...input }),
}

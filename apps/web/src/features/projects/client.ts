import { appCheckHeaders, auth } from '../../lib/firebase'

export interface ProjectSummary {
  id: string
  clientId: string
  clientName: string
  name: string
  code: string
  status: 'draft' | 'planned' | 'active' | 'on_hold' | 'completed' | 'archived' | 'cancelled'
  managerName: string
  departmentName: string | null
  startsOn: string | null
  dueOn: string | null
  clientVisible: boolean
  activeMemberCount: number
  openTaskCount: number
  version: number
}

export interface ProjectManagementSnapshot {
  projects: readonly ProjectSummary[]
  clients: readonly { id: string; name: string }[]
  departments: readonly { id: string; name: string }[]
  managers: readonly { userId: string; displayName: string }[]
  capabilities: {
    create: boolean
    manage: boolean
    manageMembers: boolean
    archive: boolean
    viewFinancial: boolean
    manageFinancial: boolean
  }
}

export interface ProjectManagementClient {
  load(organizationId: string): Promise<ProjectManagementSnapshot>
  create(organizationId: string, input: {
    clientId: string; name: string; code: string; departmentId?: string; managerUserId: string;
    startsOn?: string; dueOn?: string; clientVisible: boolean
  }): Promise<void>
  setClientVisibility(organizationId: string, projectId: string, expectedVersion: number, clientVisible: boolean): Promise<void>
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
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'PROJECT_REQUEST_FAILED')
  return envelope.data
}

export const projectManagementClient: ProjectManagementClient = {
  load: (organizationId) => post('/v1/projects/query', { organizationId, limit: 50 }),
  create: (organizationId, input) => post('/v1/projects/create', { organizationId, ...input }),
  setClientVisibility: (organizationId, projectId, expectedVersion, clientVisible) =>
    post('/v1/projects/client-visibility', { organizationId, projectId, expectedVersion, clientVisible }),
}

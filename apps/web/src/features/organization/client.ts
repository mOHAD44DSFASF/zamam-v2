import { appCheckHeaders, auth } from '../../lib/firebase'

export interface OrganizationDirectoryDepartment {
  id: string
  name: string
  code: string
  managerName: string | null
  activeTeamCount: number
  version: number
}

export interface OrganizationDirectoryTeam {
  id: string
  departmentId: string
  name: string
  code: string
  leaderName: string | null
  activeMemberCount: number
  version: number
}

export interface OrganizationDirectorySnapshot {
  organization: { id: string; name: string; locale: 'ar' | 'en'; timezone: string }
  departments: readonly OrganizationDirectoryDepartment[]
  teams: readonly OrganizationDirectoryTeam[]
  capabilities: {
    createDepartment: boolean
    createTeam: boolean
    manageMembership: boolean
    archiveStructure: boolean
    archiveTeam: boolean
  }
}

export interface OrganizationDirectoryClient {
  load(organizationId: string): Promise<OrganizationDirectorySnapshot>
  createDepartment(organizationId: string, input: { name: string; code: string }): Promise<void>
  createTeam(organizationId: string, input: { departmentId: string; name: string; code: string }): Promise<void>
  archiveDepartment(organizationId: string, departmentId: string, expectedVersion: number): Promise<void>
  archiveTeam(organizationId: string, teamId: string, expectedVersion: number): Promise<void>
}

interface Envelope<T> {
  data?: T
  error?: { code: string; message: string }
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
  const envelope = await response.json() as Envelope<T>
  if (!response.ok || envelope.error || !envelope.data) throw new Error(envelope.error?.code ?? 'DIRECTORY_REQUEST_FAILED')
  return envelope.data
}

export const organizationDirectoryClient: OrganizationDirectoryClient = {
  load: (organizationId) => post('/v1/organization/directory/query', { organizationId }),
  createDepartment: (organizationId, input) =>
    post<void>('/v1/organization/departments/create', { organizationId, id: crypto.randomUUID(), ...input }),
  createTeam: (organizationId, input) =>
    post<void>('/v1/organization/teams/create', { organizationId, id: crypto.randomUUID(), ...input }),
  archiveDepartment: (organizationId, departmentId, expectedVersion) =>
    post<void>('/v1/organization/departments/archive', { organizationId, departmentId, expectedVersion }),
  archiveTeam: (organizationId, teamId, expectedVersion) =>
    post<void>('/v1/organization/teams/archive', { organizationId, teamId, expectedVersion }),
}

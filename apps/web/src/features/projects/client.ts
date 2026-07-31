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
  transition(organizationId: string, projectId: string, expectedVersion: number, targetStatus: 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled'): Promise<void>
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

interface RawProjectRow {
  id?: unknown; clientId?: unknown; clientName?: unknown; managerName?: unknown; departmentName?: unknown
  name?: unknown; code?: unknown; status?: unknown
  startsOn?: unknown; dueOn?: unknown; clientVisible?: unknown; version?: unknown
}

/**
 * `/v1/projects/query` returns `{ items, nextCursor }` — raw project docs, not the
 * ProjectManagementSnapshot (client/manager/department names, counts, capability flags, and the
 * clients/departments/managers pick-lists) this screen expects. Adapter maps the real projects into a
 * valid snapshot; derived names render as placeholders, pick-lists empty, capabilities fail closed
 * (backend still enforces). Tracked as audit M1/M2.
 */
function toProjectSnapshot(raw: {
  items?: readonly RawProjectRow[]
  clients?: ProjectManagementSnapshot['clients']
  departments?: ProjectManagementSnapshot['departments']
  managers?: ProjectManagementSnapshot['managers']
  capabilities?: ProjectManagementSnapshot['capabilities']
}): ProjectManagementSnapshot {
  const projects: ProjectSummary[] = (raw.items ?? []).map((row) => ({
    id: String(row.id ?? ''), clientId: String(row.clientId ?? ''),
    clientName: typeof row.clientName === 'string' && row.clientName ? row.clientName : String(row.clientId ?? ''),
    name: typeof row.name === 'string' ? row.name : '', code: typeof row.code === 'string' ? row.code : '',
    status: (typeof row.status === 'string' ? row.status : 'draft') as ProjectSummary['status'],
    managerName: typeof row.managerName === 'string' ? row.managerName : '',
    departmentName: typeof row.departmentName === 'string' ? row.departmentName : null,
    startsOn: typeof row.startsOn === 'string' ? row.startsOn : null,
    dueOn: typeof row.dueOn === 'string' ? row.dueOn : null,
    clientVisible: Boolean(row.clientVisible), activeMemberCount: 0, openTaskCount: 0,
    version: typeof row.version === 'number' ? row.version : 1,
  }))
  return {
    projects, clients: raw.clients ?? [], departments: raw.departments ?? [], managers: raw.managers ?? [],
    capabilities: raw.capabilities ?? { create: false, manage: false, manageMembers: false, archive: false, viewFinancial: false, manageFinancial: false },
  }
}

export const projectManagementClient: ProjectManagementClient = {
  load: async (organizationId) => toProjectSnapshot(await post('/v1/projects/query', { organizationId, limit: 50 })),
  create: (organizationId, input) => post('/v1/projects/create', { organizationId, id: crypto.randomUUID(), ...input }),
  setClientVisibility: (organizationId, projectId, expectedVersion, clientVisible) =>
    post('/v1/projects/client-visibility', { organizationId, projectId, expectedVersion, clientVisible }),
  transition: (organizationId, projectId, expectedVersion, targetStatus) =>
    post('/v1/projects/transition', { organizationId, projectId, expectedVersion, targetStatus }),
}

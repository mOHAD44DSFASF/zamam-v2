import { appCheckHeaders, auth } from '../../lib/firebase'

export interface ClientSummary {
  id: string
  name: string
  code: string
  industry: string | null
  status: 'lead' | 'active' | 'paused' | 'archived'
  activeProjectCount: number
}

export interface ClientContactView {
  id: string
  clientId: string
  name: string
  emailDisplay: string
  portalStatus: 'none' | 'eligible' | 'invited' | 'active' | 'disabled'
  clientAdmin: boolean
  version: number
}

export interface ClientManagementSnapshot {
  clients: readonly ClientSummary[]
  contacts: readonly ClientContactView[]
  capabilities: { create: boolean; manage: boolean; manageContacts: boolean; archive: boolean }
}

export interface ClientManagementClient {
  load(organizationId: string): Promise<ClientManagementSnapshot>
  create(organizationId: string, input: { name: string; code: string; industry?: string }): Promise<void>
  addContact(organizationId: string, input: { clientId: string; name: string; email: string; clientAdmin: boolean }): Promise<void>
  setEligibility(organizationId: string, input: { clientId: string; contactId: string; expectedVersion: number; eligible: boolean }): Promise<void>
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
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'CLIENT_REQUEST_FAILED')
  return envelope.data
}

interface RawClientRow { id?: unknown; name?: unknown; code?: unknown; industry?: unknown; status?: unknown }

/**
 * `/v1/clients/query` returns `{ items: [...] }` — raw client docs, not the ClientManagementSnapshot
 * (contacts, capability flags, active-project counts) this screen expects. Adapter maps the real clients
 * into a valid snapshot; contacts empty, counts 0, capabilities fail closed (backend still enforces).
 * Tracked as audit M1/M2.
 */
function toClientSnapshot(raw: { items?: readonly RawClientRow[]; capabilities?: ClientManagementSnapshot['capabilities'] }): ClientManagementSnapshot {
  const clients: ClientSummary[] = (raw.items ?? []).map((row) => ({
    id: String(row.id ?? ''), name: typeof row.name === 'string' ? row.name : '',
    code: typeof row.code === 'string' ? row.code : '',
    industry: typeof row.industry === 'string' ? row.industry : null,
    status: (typeof row.status === 'string' ? row.status : 'active') as ClientSummary['status'],
    activeProjectCount: 0,
  }))
  return { clients, contacts: [], capabilities: raw.capabilities ?? { create: false, manage: false, manageContacts: false, archive: false } }
}

export const clientManagementClient: ClientManagementClient = {
  load: async (organizationId) => toClientSnapshot(await post('/v1/clients/query', { organizationId })),
  create: (organizationId, input) => post('/v1/clients/create', { organizationId, ...input }),
  addContact: (organizationId, input) => post('/v1/clients/contacts/create', { organizationId, ...input }),
  setEligibility: (organizationId, input) => post('/v1/clients/contacts/eligibility', { organizationId, ...input }),
}

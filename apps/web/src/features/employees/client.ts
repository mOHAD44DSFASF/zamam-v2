import { appCheckHeaders, auth } from '../../lib/firebase'

export interface EmployeeDirectoryItem {
  userId: string
  displayName: string
  whatsappPhone: string | null
  employeeNumber: string
  jobTitle: string
  departmentId: string
  departmentName: string
  employmentType: 'employee' | 'contractor'
  status: 'planned' | 'active' | 'on_leave' | 'suspended' | 'ended'
  mustChangePassword: boolean
}

export interface EmployeeDirectorySnapshot {
  items: readonly EmployeeDirectoryItem[]
  departments: readonly { id: string; name: string }[]
  capabilities: { invite: boolean; update: boolean; disable: boolean; viewHr: boolean }
}

export interface InviteEmployeeForm {
  email: string
  displayName: string
  firstName: string
  employeeNumber: string
  employmentType: 'employee' | 'contractor'
  primaryDepartmentId: string
  jobTitle: string
  startDate: string
  locale: 'ar'
  timezone: string
  role: 'Employee' | 'DepartmentLead' | 'Manager'
}

/** Area 1: direct member creation — same shape as InviteEmployeeForm plus the required WhatsApp number,
 * restricted to Owner/Manager (see capabilities.invite, reused as-is — the backend gates 'user.invite' to
 * exactly those roles now, see packages/authorization/src/default-roles.ts). */
export interface CreateMemberForm extends InviteEmployeeForm { whatsappPhone: string }
export interface CreateMemberResult { userId: string; temporaryPassword: string }

export interface EmployeeDirectoryClient {
  load(organizationId: string): Promise<EmployeeDirectorySnapshot>
  invite(organizationId: string, input: InviteEmployeeForm): Promise<void>
  createDirect(organizationId: string, input: CreateMemberForm): Promise<CreateMemberResult>
  disable(organizationId: string, userId: string, reason: string): Promise<void>
  changeOwnPassword(organizationId: string, newPassword: string): Promise<void>
  updateOwnWhatsappPhone(organizationId: string, whatsappPhone: string): Promise<void>
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
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'EMPLOYEE_REQUEST_FAILED')
  return envelope.data
}

interface RawEmployeeRow {
  userId?: unknown; displayName?: unknown; whatsappPhone?: unknown; jobTitle?: unknown; employmentStatus?: unknown
  employeeNumber?: unknown; employmentType?: unknown; primaryDepartmentId?: unknown; departmentName?: unknown
  mustChangePassword?: unknown
}

/**
 * `/v1/employees/query` returns `{ items: [...] }` — membership rows, not the enriched
 * EmployeeDirectorySnapshot this screen expects (department names, employee numbers, capability flags).
 * That composition doesn't exist server-side yet, so this adapter maps the real rows into a valid,
 * non-crashing snapshot: employee-number/department are rendered as placeholders, `departments` is empty
 * (the create-form dropdown is empty until the backend composes it), and capabilities fail closed
 * (create/manage buttons hidden — the backend still enforces every command). Tracked as audit M1/M2.
 */
function toEmployeeSnapshot(raw: { items?: readonly RawEmployeeRow[]; departments?: EmployeeDirectorySnapshot['departments']; capabilities?: EmployeeDirectorySnapshot['capabilities'] }): EmployeeDirectorySnapshot {
  const items: EmployeeDirectoryItem[] = (raw.items ?? []).map((row) => ({
    userId: String(row.userId ?? ''),
    displayName: typeof row.displayName === 'string' ? row.displayName : '',
    whatsappPhone: typeof row.whatsappPhone === 'string' ? row.whatsappPhone : null,
    employeeNumber: typeof row.employeeNumber === 'string' ? row.employeeNumber : '',
    jobTitle: typeof row.jobTitle === 'string' ? row.jobTitle : '',
    departmentId: typeof row.primaryDepartmentId === 'string' ? row.primaryDepartmentId : '',
    departmentName: typeof row.departmentName === 'string' ? row.departmentName : '',
    employmentType: row.employmentType === 'contractor' ? 'contractor' : 'employee',
    status: (typeof row.employmentStatus === 'string' ? row.employmentStatus : 'active') as EmployeeDirectoryItem['status'],
    mustChangePassword: row.mustChangePassword === true,
  }))
  return { items, departments: raw.departments ?? [], capabilities: raw.capabilities ?? { invite: false, update: false, disable: false, viewHr: false } }
}

export const employeeDirectoryClient: EmployeeDirectoryClient = {
  load: async (organizationId) => toEmployeeSnapshot(await post('/v1/employees/query', { organizationId })),
  invite: (organizationId, input) => post('/v1/employees/invite', { organizationId, ...input }),
  // Every command handler's JSON payload is AuditCommandService's own return shape, { result, replayed }
  // (see services/functions/src/audit/service.ts) — callers that only fire-and-forget (invite/disable
  // above) never noticed, but createDirect needs the one-time temporary password back out, so it must
  // unwrap `.result` itself rather than handing the whole envelope to the caller.
  createDirect: async (organizationId, input) =>
    (await post<{ result: CreateMemberResult; replayed: boolean }>('/v1/employees/create', { organizationId, ...input })).result,
  disable: (organizationId, userId, reason) => post('/v1/employees/disable', { organizationId, userId, reason }),
  changeOwnPassword: (organizationId, newPassword) => post('/v1/employees/change-password', { organizationId, newPassword }),
  updateOwnWhatsappPhone: (organizationId, whatsappPhone) => post('/v1/employees/whatsapp/update', { organizationId, whatsappPhone }),
}

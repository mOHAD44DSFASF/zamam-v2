import { appCheckHeaders, auth } from '../../lib/firebase'

export interface EmployeeDirectoryItem {
  userId: string
  displayName: string
  employeeNumber: string
  jobTitle: string
  departmentId: string
  departmentName: string
  employmentType: 'employee' | 'contractor'
  status: 'planned' | 'active' | 'on_leave' | 'suspended' | 'ended'
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
}

export interface EmployeeDirectoryClient {
  load(organizationId: string): Promise<EmployeeDirectorySnapshot>
  invite(organizationId: string, input: InviteEmployeeForm): Promise<void>
  disable(organizationId: string, userId: string, reason: string): Promise<void>
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

export const employeeDirectoryClient: EmployeeDirectoryClient = {
  load: (organizationId) => post('/v1/employees/query', { organizationId }),
  invite: (organizationId, input) => post('/v1/employees/invite', { organizationId, ...input }),
  disable: (organizationId, userId, reason) => post('/v1/employees/disable', { organizationId, userId, reason }),
}

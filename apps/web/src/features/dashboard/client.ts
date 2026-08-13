import { appCheckHeaders, auth } from '../../lib/firebase'

export interface DashboardTaskRow {
  taskId: string
  title: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: string
  version: number
  projectId?: string
  projectName?: string | null
  departmentId?: string
  currentStepOrder: number
  currentStepName: string
  currentStepStatus: string
  currentStepWaitingReason: string | null
  currentStepDueAt: string | null
  currentStepAssigneeType: 'person' | 'department'
  currentStepAssigneeUserId?: string
  currentStepAssigneeName?: string | null
  currentStepAssigneeWhatsapp?: string | null
  currentStepAssigneeDepartmentId?: string
  stalled: boolean
}

export interface DashboardSnapshot {
  scope: 'organization' | 'department' | 'employee'
  departmentId?: string
  summary: { byStatus: Record<string, number>; byPriority: Record<string, number>; total: number; stalledCount: number }
  stalled: readonly DashboardTaskRow[]
  tasks: readonly DashboardTaskRow[]
  currentTasks?: readonly DashboardTaskRow[]
  upcomingTasks?: readonly DashboardTaskRow[]
  capabilities: { createTask: boolean; createMember: boolean }
}

export interface DashboardClient {
  load(organizationId: string): Promise<DashboardSnapshot>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL
  const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(),
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'DASHBOARD_REQUEST_FAILED')
  return envelope.data
}

export const dashboardClient: DashboardClient = {
  load: (organizationId) => post('/v1/dashboard/query', { organizationId }),
}

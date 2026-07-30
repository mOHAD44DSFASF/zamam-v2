import { auth } from '../../lib/firebase'

export interface WorkTemplateSummary {
  id: string
  name: string
  templateType: 'task' | 'project'
  status: 'draft' | 'published' | 'archived'
  version: number
  workflowName: string | null
}

export interface RecurrenceSummary {
  id: string
  templateId: string
  templateName: string
  status: 'active' | 'paused' | 'archived'
  frequency: 'daily' | 'weekly' | 'monthly'
  timezone: string
  timeLocal: string
  nextRunAt: string | null
  version: number
}

export interface TemplateSnapshot {
  templates: readonly WorkTemplateSummary[]
  schedules: readonly RecurrenceSummary[]
  capabilities: { create: boolean; publish: boolean; manageRecurrence: boolean }
}

export interface TemplateClient {
  load(organizationId: string): Promise<TemplateSnapshot>
  create(organizationId: string, input: { name: string; templateType: 'task' | 'project' }): Promise<void>
  publish(organizationId: string, templateId: string, expectedVersion: number): Promise<void>
  setScheduleStatus(organizationId: string, scheduleId: string, expectedVersion: number, status: 'active' | 'paused'): Promise<void>
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
      ...(import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
        ? { 'x-firebase-appcheck': 'emulator-app-check' }
        : {}),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) {
    throw new Error(envelope.error?.code ?? 'TEMPLATE_REQUEST_FAILED')
  }
  return envelope.data
}

export const templateClient: TemplateClient = {
  load: (organizationId) => post('/v1/templates/query', { organizationId, limit: 50 }),
  create: (organizationId, input) => post('/v1/templates/create', {
    organizationId,
    id: crypto.randomUUID(),
    payload: {},
    ...input,
  }),
  publish: (organizationId, templateId, expectedVersion) =>
    post('/v1/templates/publish', { organizationId, templateId, expectedVersion }),
  setScheduleStatus: (organizationId, scheduleId, expectedVersion, status) =>
    post('/v1/recurrences/status', {
      organizationId,
      scheduleId,
      expectedVersion,
      status,
      ...(status === 'active' ? { resumeAfter: new Date().toISOString() } : {}),
    }),
}

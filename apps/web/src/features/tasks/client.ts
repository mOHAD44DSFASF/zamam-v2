import { auth } from '../../lib/firebase'

export interface TaskSummary {
  id: string
  projectId: string
  projectName: string
  workspaceName: string | null
  title: string
  description: string
  status: 'draft' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'approved' | 'completed' | 'cancelled' | 'archived'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueAt: string | null
  assigneeNames: readonly string[]
  clientVisible: boolean
  version: number
  subtaskCount: number
  completedSubtaskCount: number
  checklistCount: number
  completedChecklistCount: number
  workflow?: {
    instanceId: string
    workflowVersionId: string
    currentStageKey: string
    currentStageName: string
    concurrencyVersion: number
    stageDueAt: string | null
    availableTransitions: readonly { key: string; label: string; toStageName: string }[]
  }
}
export interface TaskSnapshot {
  tasks: readonly TaskSummary[]
  projects: readonly { id: string; name: string }[]
  workspaces: readonly { id: string; name: string; projectId?: string }[]
  capabilities: { create: boolean; update: boolean; transition: boolean; assign: boolean; reopen: boolean; archive: boolean; saveView: boolean }
}
export interface TaskClient {
  load(organizationId: string): Promise<TaskSnapshot>
  create(organizationId: string, input: {
    projectId: string; workspaceId?: string; title: string; description: string;
    priority: TaskSummary['priority']; dueAt?: string; clientVisible: boolean
  }): Promise<void>
  update(organizationId: string, input: {
    taskId: string; expectedVersion: number; title: string; description: string;
    priority: TaskSummary['priority']; dueAt: string | null; clientVisible: boolean
  }): Promise<void>
  saveView(organizationId: string, input: { name: string; view: 'list' | 'board' | 'calendar' | 'timeline' }): Promise<void>
  transitionWorkflow(organizationId: string, input: { instanceId: string; transitionKey: string; expectedConcurrencyVersion: number }): Promise<void>
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
      ...(import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ? { 'x-firebase-appcheck': 'emulator-app-check' } : {}),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'TASK_REQUEST_FAILED')
  return envelope.data
}

export const taskClient: TaskClient = {
  load: (organizationId) => post('/v1/tasks/query', { organizationId, limit: 50 }),
  create: (organizationId, input) => post('/v1/tasks/create', { organizationId, id: crypto.randomUUID(), ...input }),
  update: (organizationId, input) => post('/v1/tasks/update', { organizationId, ...input }),
  saveView: (organizationId, input) => post('/v1/task-views/create', {
    organizationId, id: crypto.randomUUID(), resourceType: 'task',
    name: input.name, filters: { presentation: input.view }, visibility: 'private',
  }),
  transitionWorkflow: (organizationId, input) => post('/v1/workflows/instances/transition', { organizationId, ...input }),
}
